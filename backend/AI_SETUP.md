# Local AI setup

Momentum Tracker runs its AI features on a **local Llama model** — nothing is
sent to any third-party service. Your résumés, employment history and job
applications never leave your machine.

The app works without a model. It starts in **lite mode**, which uses
deterministic templates and keyword analysis, and the UI labels output
honestly as "Smart template" rather than pretending it's AI-generated. Adding
a model upgrades it to "AI-generated" automatically — no code changes.

---

## Setup (two commands)

```bash
cd backend
pip install llama-cpp-python
python scripts/download_model.py
```

Restart the backend. That's it — the model is detected on startup.

To check which mode you're in:

```bash
python -c "from app.ai.llm import status; print(status())"
```

### Choosing a model

| Option | Model | Download | RAM needed | Notes |
|---|---|---|---|---|
| `--model small` | Llama 3.2 3B Instruct | ~2.0 GB | ~4 GB | Fastest. Fine for extraction and short drafts; prose is stiffer. |
| *(default)* | Llama 3.1 8B Instruct Q4_K_M | ~4.9 GB | ~8 GB | Best balance. Start here. |
| `--model quality` | Llama 3.1 8B Instruct Q5_K_M | ~5.7 GB | ~10 GB | Marginally better writing, slower. |

The download resumes if interrupted, and the file's GGUF magic bytes are
verified before it's accepted — a truncated model otherwise fails later with
a confusing llama.cpp error.

---

## Configuration

All optional, all environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `MOMENTUM_LLM_MODEL_PATH` | `backend/models/model.gguf` | Explicit model path |
| `MOMENTUM_LLM_THREADS` | all cores | CPU threads |
| `MOMENTUM_LLM_CONTEXT` | `4096` | Context window in tokens |
| `MOMENTUM_LLM_GPU_LAYERS` | `0` | Layers offloaded to GPU |
| `MOMENTUM_LLM_DISABLED` | unset | Set to `1` to force lite mode |

Any `.gguf` dropped into `backend/models/` is picked up automatically, so you
can keep the original download filename.

### GPU acceleration

Roughly 5–10× faster generation. Reinstall with GPU support, then offload:

```bash
# NVIDIA / CUDA
CMAKE_ARGS="-DGGML_CUDA=on" pip install llama-cpp-python --force-reinstall --no-cache-dir
export MOMENTUM_LLM_GPU_LAYERS=35

# Apple Silicon (Metal is usually enabled by default)
CMAKE_ARGS="-DGGML_METAL=on" pip install llama-cpp-python --force-reinstall --no-cache-dir
export MOMENTUM_LLM_GPU_LAYERS=1
```

---

## Architecture

```
routers/  ──►  ai/engine.py  ──►  ai/llm.py  ──►  llama_cpp (optional)
                    │                 │
                    │                 ├── fence()          untrusted-text handling
                    │                 ├── complete_json()  grammar-constrained JSON
                    │                 └── status()         lite vs llm
                    └── lite fallbacks (always available)
```

Every generator follows the same shape: try the model, fall back to a
grounded template, and report which one produced the result. No feature ever
hard-fails because a model is missing.

### Which technique does what

Not everything should be an LLM, and in this codebase it isn't:

- **ATS scoring** is deterministic — keyword coverage plus term similarity.
  A score that changed between runs would be a bug, and the report has to be
  explainable. The LLM only writes the *narrative summary* of a score it
  didn't compute.
- **Résumé tailoring** reorders and rephrases only. Experience, education and
  dates pass through verbatim. A hallucinated employer on a CV is actively
  harmful to the user, so the model is never given the opportunity.
- **Cover letters and follow-ups** are genuinely generative — this is where
  a model earns its place.

---

## Security: prompt injection

The Chrome extension scrapes job descriptions from arbitrary web pages, so
**that text is untrusted input**, exactly like user-submitted HTML. A posting
containing `IGNORE ALL PREVIOUS INSTRUCTIONS…` will be obeyed by a naive
prompt.

Every untrusted span is wrapped with `llm.fence()` before it reaches a
prompt, which:

1. neutralises known hijack phrasings and chat-template control tokens
   (`<|im_end|>`, `[INST]` — these are real prompt breaks, not hypothetical);
2. truncates, so a long payload can't push the real instructions out of the
   context window;
3. delimits with a tag the payload cannot close.

This is defence in depth, **not a guarantee** — no known technique makes an
LLM fully injection-proof. The load-bearing protection is architectural:
model output is only ever rendered as escaped text and never triggers an
action by itself. Keep it that way.

---

## Evals

```bash
python evals/run_evals.py
python evals/run_evals.py --only injection
```

Run these after any prompt change. They assert *properties* rather than exact
strings — the applicant's name appears, no employer was invented, JSON
parses, injection payloads don't survive — because exact-match assertions
fail constantly at non-zero temperature and train you to ignore the suite.

The suite passes in lite mode too, so it's meaningful even without a model
installed. It has already caught one real crash.

---

## Troubleshooting

**Still says "Smart template"** — run the status command above. Common causes:
`llama-cpp-python` not installed, no `.gguf` in `backend/models/`, or
`MOMENTUM_LLM_DISABLED=1`.

**Very slow** — expect ~20–60s per cover letter on CPU for an 8B model. Use
`--model small` or enable GPU offload.

**Process killed / out of memory** — the model needs its full size in RAM plus
context. Drop to `--model small` or lower `MOMENTUM_LLM_CONTEXT`.

**Generation is repetitive or ignores instructions** — you may have a base
rather than instruction-tuned model. The names above all end in `-Instruct`
for this reason.
