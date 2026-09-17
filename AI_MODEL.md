# AI model

Everything in the app that writes — **Tailor to a job**, cover letters, ATS
suggestions and the assistant — goes through one model. Until you give it one,
that model is a local GGUF file that most installs don't have, so every feature
silently falls back to a filled-in template. That is why *Tailor to a job*
looked broken: it wasn't erroring, it was producing a template.

## Setting one up

**Job Hunt → AI model.** Pick a provider, paste a key, press **Save & test
connection**. A green tick means every AI feature is now using it.

Eighteen providers are built in. Most of the industry adopted OpenAI's request
format, so DeepSeek, Kimi, Qwen and the rest differ only in base URL and model
name — they share one adapter.

| Provider | Key from | Notes |
| --- | --- | --- |
| OpenAI | platform.openai.com | GPT models |
| Anthropic | console.anthropic.com | Claude |
| Google Gemini | aistudio.google.com | Free tier |
| **DeepSeek** | platform.deepseek.com | Very cheap |
| **Moonshot (Kimi)** | platform.moonshot.ai | Long context. Mainland accounts use `api.moonshot.cn` |
| **Qwen** | bailian.console.alibabacloud.com | International endpoint by default |
| **Zhipu / Z.ai** | open.bigmodel.cn | GLM models |
| **Mistral** | console.mistral.ai | EU-hosted |
| **Groq** | console.groq.com | Very fast open models |
| **xAI** | console.x.ai | Grok |
| **Perplexity** | perplexity.ai/settings/api | Web-grounded answers |
| **OpenRouter** | openrouter.ai/keys | One key, hundreds of models — easiest way to try several |
| **Together / Fireworks / Cerebras / DeepInfra** | each provider | Open models |
| Ollama | — | Local. No key, no cost, nothing leaves the computer |
| Other | — | Any OpenAI-compatible endpoint: LM Studio, vLLM, LiteLLM, a company gateway |

Ollama is the one to pick if you would rather not send your CV to a third
party: install it, `ollama pull llama3.1`, choose Ollama, leave the base URL
blank.

## Don't trust the model names

**Press "Fetch models" rather than the placeholder.** Model names churn fast —
DeepSeek moved V3 → V4 and Kimi K2 → K3 within months of this being written, so
any list hardcoded in an app is wrong within a release or two. The button asks
your provider what it serves *today* and fills the dropdown from the answer.
Embedding, audio and image models are filtered out, since they can't hold a
conversation.

The field stays free text on purpose: private deployments and fine-tunes serve
models the list call won't return, and being unable to type one would be worse
than a slightly busier control.

Switching provider clears the model box. `gpt-4o-mini` left behind after a
switch to DeepSeek produces a 404 that reads like a broken key.

## Writing the way you want

Three settings, applied to *every* generation rather than retyped per feature:

- **Tone** — professional, warm, direct, understated, academic.
- **Length** — short, medium, long.
- **Custom instructions** — free text, and it wins over the presets. This is the
  useful one: *"British spelling, no buzzwords, never claim a skill that isn't
  on my CV, keep cover letters under 300 words."*

## Where the key lives

Encrypted at rest with a key derived from `MOMENTUM_SECRET_KEY`, in your own
database. The API never returns it — reads get a hint like `sk-…7f2a`, enough to
tell two keys apart and useless to anyone reading over your shoulder. It is sent
to exactly one place: the provider you chose.

If you change `MOMENTUM_SECRET_KEY`, the stored key can no longer be decrypted.
The app reports "key rejected" and asks for it again rather than crashing.

## How it is wired

The check sits *underneath* `app/ai/llm.py` and `app/ai/engine.py`, not beside
them, which is why one key lights up six features at once — the routers that
generate résumés and letters were never changed and don't know a hosted provider
exists.

| File | Responsibility |
| --- | --- |
| `app/ai/remote.py` | The provider registry, four API adapters, live model listing, style suffix |
| `app/ai/keystore.py` | Encrypt / decrypt / hint the API key |
| `app/ai/userconfig.py` | Load a user's config; bound per request from `get_current_user` |
| `app/ai/engine.py` | `_RemoteLLM` presents llama_cpp's calling convention, so both models are interchangeable |
| `app/routers/llm_settings.py` | `/api/llm/settings`, `/api/llm/test`, `/api/llm/providers`, `/api/llm/models` |

**A remote failure falls back rather than raising.** Every existing caller was
written against "None means no model", so a provider being down degrades to the
old template exactly as a missing GGUF does — it doesn't 500 the page.

### One thing worth knowing about

FastAPI runs sync dependencies and sync endpoints as *separate* threadpool
tasks, each with a copy of the context. A plain `ContextVar.set()` in the auth
dependency therefore writes to a copy that is thrown away on return: the
endpoint sees the default, and every AI feature stays in template mode with the
key correctly stored and correctly loaded. The ContextVar holds a mutable box,
installed by middleware in the parent context; copies share the box, so the
dependency mutating it is visible downstream.


## When it says the key was rejected

The error now quotes the provider rather than guessing, and three cases look
alike but aren't:

| Message | What it actually is |
| --- | --- |
| *Out of credit or quota…* | Billing. Add credit or enable billing — nothing to do with speed |
| *Too many requests — slow down…* | A real rate limit. Wait and retry |
| *Blocked before reaching the API (Cloudflare error 1010)* | Not the provider at all. Their edge blocked the request; **your key was never checked** |

**Cloudflare 1010** was self-inflicted: `urllib` identifies itself as
`Python-urllib/3.11`, and providers behind Cloudflare's browser-integrity check
treat that as a bot signature. Every request now sends a truthful
`User-Agent`, which is all those checks wanted. If it still happens, the
provider is blocking server-side calls from your network — try another
provider.

**Groq is not Grok.** Groq is an inference host (keys `gsk_…`); Grok is xAI's
model (keys `xai-…`). Paste a key and the app checks the prefix against the
selected provider, because that 401 is otherwise indistinguishable from a bad
key.


## Tailoring an uploaded résumé

"Tailor to a job" used to work only on résumés built in the Resume Builder,
because tailoring regenerates a PDF from structured fields and an uploaded file
has none. Anyone who uploaded a PDF — most people, since that is the file they
already have — was told to retype their whole CV into the builder first, which
meant the feature was effectively off for its main audience.

It now reads the uploaded file back into builder fields using your configured
model, then tailors normally. The text was already extracted for ATS scoring,
so nothing new is asked of you.

- **The parse is cached.** It runs once per file and is saved onto the résumé,
  so tailoring the same CV for a second job costs nothing extra.
- **Nothing is invented.** The prompt forbids adding employers, dates, degrees
  or skills that aren't in the text, and the result is checked against the
  source: if the name or the employers don't appear in the original file, the
  parse is rejected and nothing is saved. A résumé that quietly gains a job is
  worse than one that fails to parse.
- **Scanned PDFs still can't be read** — there is no text layer to work from,
  and the error says so rather than failing vaguely.
- Uploaded résumés render into a clean single-column template by default; you
  can change it afterwards like any other builder résumé.

Needs a model configured (Tools → AI Model), since the parsing is the AI part.


## How tailoring works

The résumé is split into its sections, each is rewritten against its own
evidence, and the document is reassembled. It is not one call asking for a
whole résumé — that produces a model rewriting the parts it was told to leave
alone, dropping entries to save tokens, and changing dates.

| Section | What happens |
| --- | --- |
| Summary | Rewritten using **your actual experience** as the source material, aimed at the job |
| Experience | One call per role, rewriting only that role's bullets |
| Skills | Reordered so the relevant categories lead. Nothing is added |
| Projects | Bullets only, same rules as experience |
| Education, certifications, languages | Untouched |
| Job titles, companies, dates | **Never sent for rewriting** — copied verbatim |

The earlier version sent the model your old summary and the job ad, and nothing
else. With only the advert as material it wrote about the advert, which is how
a backend engineer's résumé came back describing a machine learning engineer
"eager to contribute expertise in PyTorch/JAX". The summary call now sees the
person's real roles and is told not to claim anything they don't evidence.

Guards, each of which returns the original text rather than a guess:

- A rewrite that changes the **bullet count** has merged or invented bullets —
  rejected.
- A summary that comes back **too short or too long** — rejected.
- Any section whose call **fails** keeps its original content, so a flaky model
  costs one bullet list rather than the document.
- Model preamble ("Here are the rewritten bullets:") is stripped rather than
  printed onto your résumé.

Because only the text *inside* entries is replaced, entry count, order, headers
and the template all survive — a tailored résumé looks like the résumé it came
from.
