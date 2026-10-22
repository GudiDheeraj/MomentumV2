"""Bring-your-own LLM: run the AI features through a hosted model.

Everything in this app that writes — tailored résumés, cover letters, ATS
suggestions, the assistant — went through a local GGUF model. With no model
file present that path returns None and every feature degrades to a filled-in
template. It works, it just isn't useful, and "Tailor to a job" producing a
template is exactly what that looks like from outside.

This adds a second route to the same functions: paste an API key, and the same
prompts go to a hosted model instead. Deliberately wired underneath
`app/ai/llm.py` rather than beside it, so every existing caller — six routers
that know nothing about this file — starts working from one setting.

Seventeen providers, no new dependencies (urllib only), across four API
shapes. Most of the industry standardised on OpenAI's request format, so
DeepSeek, Kimi, Qwen, Mistral, Groq, xAI, OpenRouter and the rest differ only
in base URL and model name — they share one adapter. Anthropic, Gemini and
Ollama each need their own.

    api kind      providers
    openai        openai, deepseek, moonshot (Kimi), qwen, zhipu (GLM),
                  mistral, groq, xai (Grok), perplexity, openrouter,
                  together, fireworks, cerebras, deepinfra, custom
    anthropic     anthropic
    gemini        gemini
    ollama        legacy — no longer offered in the picker, but the transport
                  stays so an account already pointed at a local Ollama keeps
                  working rather than breaking on upgrade

**Model names go stale, so don't trust the defaults here.** DeepSeek moved to
V4 and Kimi to K3 within months of these being written. Every default below is
a starting point; `list_models()` asks the provider what it actually serves
today, and the settings page has a button for it. That is the difference
between a provider list that ages and one that doesn't.

Style preferences travel with the config, because "generate it the way I want"
is the actual requirement: a tone, a length, and a free-text instruction that
is appended to every system prompt.
"""

from __future__ import annotations

import contextvars
import json
import logging
import urllib.error
import urllib.request
from contextvars import ContextVar
from dataclasses import dataclass, field

log = logging.getLogger("momentum.ai")

TIMEOUT = 120

# urllib identifies itself as "Python-urllib/3.11" unless told otherwise, and
# several providers sit behind Cloudflare with browser-integrity checks that
# treat that string as a bot signature. The result is HTTP 403 with a
# Cloudflare error code in the body — which looks exactly like the API
# rejecting your key, and sends people off regenerating a perfectly good one.
# A truthful, specific User-Agent is all it takes.
BASE_HEADERS = {
    "User-Agent": "MomentumTracker/1.0 (+https://github.com/momentum-tracker)",
    "Accept": "application/json",
}


@dataclass
class LLMConfig:
    provider: str = "openai"
    api_key: str = ""
    model: str = ""
    base_url: str = ""
    tone: str = ""
    length: str = ""
    instructions: str = ""
    temperature: float = 0.7

    def is_usable(self) -> bool:
        # Ollama is the exception: a local server needs no key.
        if self.provider == "ollama":
            return bool(self.base_url or True)
        return bool(self.api_key and self.provider)


# Where llm.py finds the caller's key, without every function in app/ai/
# growing a `user` argument it has no other use for.
#
# The subtlety that cost an afternoon: FastAPI runs sync dependencies and sync
# endpoints in *separate* threadpool tasks, and each task gets a **copy** of the
# context. A plain `ContextVar.set()` inside the dependency therefore writes to
# a copy that is discarded the moment it returns — the endpoint sees the
# default, and every AI feature silently stays in lite mode with the key
# correctly stored and correctly loaded.
#
# So the ContextVar holds a mutable box, installed once per request by
# middleware (which runs in the parent context). Copies of a context share the
# same box object, so the dependency mutating it *is* visible downstream.
_scope: ContextVar[dict] = ContextVar("momentum_llm_scope", default=None)


def new_request_scope() -> dict:
    """Called by middleware at the start of each request. The returned box is
    what every later copy of this context will see."""
    box = {"cfg": None}
    _scope.set(box)
    return box


def set_current(config: LLMConfig | None) -> None:
    box = _scope.get()
    if box is None:
        # No middleware — a background job or a script. Still works, it just
        # doesn't survive a threadpool hop, which such callers don't make.
        box = new_request_scope()
    box["cfg"] = config


def current() -> LLMConfig | None:
    box = _scope.get()
    cfg = box.get("cfg") if box else None
    return cfg if (cfg and cfg.is_usable()) else None


# What it costs to run a provider, which is the first thing anyone wants to
# know and the last thing any of these catalogues tell you.
#
#   free     an ongoing free tier — an account, a key, and you are calling it.
#            Rate-limited, sometimes to a subset of models, but not billed.
#   credits  free credit on signup, then billed. Fine to try, runs out.
#   paid     billed from the first token. Some are very cheap; still billed.
#
# Checked August 2026. **These change** — providers add, shrink and withdraw
# free tiers constantly — so the panel says as much and links each provider's
# own page rather than pretending this list is authoritative.
COST_TIERS = {
    "free":    ("Free tier", "No card needed. Rate-limited, but not billed."),
    "credits": ("Free credits", "Some free credit to start, then billed."),
    "paid":    ("Paid", "Billed per token from the first call."),
}
COST_ORDER = ("free", "credits", "paid", "")

# id -> (label, api kind, base URL, default model, where to get a key, note)
# `api` is what decides the request shape; everything else is data.
PROVIDERS: dict[str, dict] = {
    "openai": {
        "cost": "credits",
        "label": "OpenAI", "api": "openai",
        "base": "https://api.openai.com/v1", "model": "gpt-4o-mini",
        "keys": "platform.openai.com/api-keys",
        "note": "GPT models. Signup credit on new accounts, then billed.",
    },
    "anthropic": {
        "cost": "credits",
        "label": "Anthropic (Claude)", "api": "anthropic",
        "base": "https://api.anthropic.com/v1", "model": "claude-sonnet-5",
        "keys": "console.anthropic.com/settings/keys",
        "note": "Claude models. Signup credit on new accounts, then billed.",
    },
    "gemini": {
        "cost": "free",
        "label": "Google Gemini", "api": "gemini",
        "base": "https://generativelanguage.googleapis.com/v1beta",
        "model": "gemini-2.0-flash",
        "keys": "aistudio.google.com/apikey",
        "note": "Free tier on the Flash models from an AI Studio key, no card. "
                "The larger models are billed.",
    },
    "deepseek": {
        "cost": "paid",
        "label": "DeepSeek", "api": "openai",
        "base": "https://api.deepseek.com/v1", "model": "deepseek-chat",
        "keys": "platform.deepseek.com/api_keys",
        "note": "Billed, but among the cheapest per token. `deepseek-chat` is "
                "a compatibility alias that follows their current model — "
                "press Fetch models for the V4 names.",
    },
    "moonshot": {
        "cost": "credits",
        "label": "Moonshot (Kimi)", "api": "openai",
        "base": "https://api.moonshot.ai/v1", "model": "moonshot-v1-32k",
        "keys": "platform.moonshot.ai/console/api-keys",
        "note": "Long context. The K-series names change often — Fetch models "
                "for the current one. Mainland accounts use api.moonshot.cn.",
    },
    "qwen": {
        "cost": "credits",
        "label": "Qwen (Alibaba DashScope)", "api": "openai",
        "base": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-plus",
        "keys": "bailian.console.alibabacloud.com",
        "note": "International endpoint. Mainland: dashscope.aliyuncs.com.",
    },
    "zhipu": {
        "cost": "free",
        "label": "Zhipu / Z.ai (GLM)", "api": "openai",
        "base": "https://open.bigmodel.cn/api/paas/v4", "model": "glm-4-plus",
        "keys": "open.bigmodel.cn",
        "note": "The GLM Flash models are free, no card. The larger GLM models "
                "are billed.",
    },
    "mistral": {
        "cost": "free",
        "label": "Mistral", "api": "openai",
        "base": "https://api.mistral.ai/v1", "model": "mistral-large-latest",
        "keys": "console.mistral.ai/api-keys",
        "note": "EU-hosted. Free tier for evaluation and prototyping — check "
                "their terms before using it for commercial work.",
    },
    "groq": {
        "cost": "free",
        "label": "Groq", "api": "openai",
        "base": "https://api.groq.com/openai/v1", "model": "",
        "keys": "console.groq.com/keys",
        "note": "Free tier, no card: an account and a key and you are calling "
                "it, rate-limited. Very fast inference on Llama, Qwen and "
                "other open models. Keys start with gsk_ — not the same as "
                "xAI's Grok.",
    },
    "xai": {
        "cost": "credits",
        "label": "xAI (Grok)", "api": "openai",
        "base": "https://api.x.ai/v1", "model": "",
        "keys": "console.x.ai",
        "note": "Keys start with xai-. Grok, by xAI — not the same as Groq.",
    },
    "perplexity": {
        "cost": "paid",
        "label": "Perplexity", "api": "openai",
        "base": "https://api.perplexity.ai", "model": "sonar",
        "keys": "perplexity.ai/settings/api",
        "note": "Billed. Answers are web-grounded, which is unusual for this use.",
    },
    "openrouter": {
        "cost": "free",
        "label": "OpenRouter", "api": "openai",
        "base": "https://openrouter.ai/api/v1", "model": "",
        "keys": "openrouter.ai/keys",
        "note": "One key, hundreds of models from every provider — the easiest "
                "way to try several without signing up repeatedly. Model "
                "names ending :free cost nothing, at a low daily limit.",
    },
    "together": {
        "cost": "credits",
        "label": "Together AI", "api": "openai",
        "base": "https://api.together.xyz/v1", "model": "",
        "keys": "api.together.ai/settings/api-keys",
        "note": "Open models. Signup credit, then billed.",
    },
    "fireworks": {
        "cost": "credits",
        "label": "Fireworks AI", "api": "openai",
        "base": "https://api.fireworks.ai/inference/v1", "model": "",
        "keys": "fireworks.ai/account/api-keys",
        "note": "Open models. A small signup credit, then billed.",
    },
    "cerebras": {
        "cost": "free",
        "label": "Cerebras", "api": "openai",
        "base": "https://api.cerebras.ai/v1", "model": "",
        "keys": "cloud.cerebras.ai",
        "note": "Free tier, no card. Extremely fast, on a small catalogue of "
                "open models that changes without notice.",
    },
    "deepinfra": {
        "cost": "credits",
        "label": "DeepInfra", "api": "openai",
        "base": "https://api.deepinfra.com/v1/openai", "model": "",
        "keys": "deepinfra.com/dash/api_keys",
        "note": "Open models. A small signup credit, then billed.",
    },
    "custom": {
        "cost": "",
        "label": "Other (OpenAI-compatible)", "api": "openai",
        "base": "", "model": "",
        "keys": "",
        "note": "Anything speaking OpenAI's API: LM Studio, vLLM, LiteLLM, a "
                "company gateway. Set the base URL yourself.",
    },
}

DEFAULT_MODELS = {k: v["model"] for k, v in PROVIDERS.items()}
DEFAULT_BASES = {k: v["base"] for k, v in PROVIDERS.items()}


def api_kind(provider: str) -> str:
    return (PROVIDERS.get((provider or "").lower()) or {}).get("api", "openai")


def provider_list() -> list[dict]:
    """The registry as the settings page wants it — no secrets in here."""
    rows = [{"id": k,
             **{f: v[f] for f in ("label", "api", "base", "model", "keys", "note")},
             # The same address twice: `keys` is what a person reads, `keys_url`
             # is what the button opens. Stored without a scheme because it is
             # printed, and printed addresses do not need one.
             "keys_url": ("https://" + v["keys"]) if v.get("keys") else "",
             "cost": v.get("cost", ""),
             "cost_label": COST_TIERS.get(v.get("cost", ""), ("", ""))[0],
             "cost_note": COST_TIERS.get(v.get("cost", ""), ("", ""))[1]}
            for k, v in PROVIDERS.items()]
    # Cheapest first, so the list opens on the ones that cost nothing.
    return sorted(rows, key=lambda r: (COST_ORDER.index(r["cost"]) if r["cost"] in COST_ORDER
                                       else len(COST_ORDER), r["label"].lower()))


class LLMError(Exception):
    pass


def _provider_message(body: bytes) -> str:
    """Dig the human-readable reason out of an error body.

    Every provider nests it somewhere different — OpenAI in error.message,
    Gemini in error.status + error.message, Anthropic in error.message,
    DeepSeek sometimes in a bare `message`. Missing one of them is how you end
    up reporting a generic guess instead of "add credits to your account".
    """
    try:
        data = json.loads(body or b"{}")
    except Exception:
        text = (body or b"").decode("utf-8", "replace").strip()
        return text[:300]
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, dict):
            return str(err.get("message") or err.get("code") or err.get("type") or "")[:300]
        if isinstance(err, str):
            return err[:300]
        for key in ("message", "detail", "msg", "error_msg"):
            if data.get(key):
                return str(data[key])[:300]
    return ""


def _tidy(detail: str) -> str:
    """A provider message pasted into a sentence needs its punctuation sorted,
    or you get "…billing details.." and "Insufficient Balance Top it up"."""
    d = (detail or "").strip()
    if not d:
        return ""
    return d if d[-1] in ".!?" else d + "."


def _raise_http(code: int, body: bytes, cause: Exception) -> None:
    """Turn a provider's HTTP error into something a person can act on.

    The rule learned the hard way: **always include what the provider said.**
    This used to swallow `detail` for 401 and 429 and substitute a guess —
    which meant "Rate limited or out of quota" was shown for keys that had
    simply never had billing enabled, for accounts at zero balance, and for
    models the plan doesn't include. Three different fixes, one misleading
    sentence, and no way to tell them apart.
    """
    detail = _provider_message(body)
    low = detail.lower()

    # Cloudflare, not the provider. Its error codes arrive as 403/503 with the
    # number in the body, and the provider's API never saw the request at all —
    # so reporting it as "the key was rejected" points at the wrong thing
    # entirely. 1010 is browser-signature banning, 1020 an access rule, 1015
    # Cloudflare's own rate limiting.
    cf = next((c for c in ("1010", "1020", "1015", "1012", "1009")
               if f"error code: {c}" in low or f"error {c}" in low), None)
    if cf or "cloudflare" in low or "attention required" in low:
        reason = {
            "1010": "the request's signature was rejected by the provider's bot protection",
            "1020": "an access rule at the provider blocked this request",
            "1015": "the provider's edge is rate limiting this address",
            "1012": "the provider's firewall blocked this address",
            "1009": "the provider blocks requests from this country",
        }.get(cf, "the provider's edge protection blocked the request")
        raise LLMError(
            f"Blocked before reaching the API — {reason}"
            f"{f' (Cloudflare error {cf})' if cf else ''}. Your key was never "
            "checked, so it is probably fine. This usually means the provider "
            "blocks server-side calls from this network — try a different "
            "provider, or a VPN if you are on a flagged connection.") from cause

    if code == 401 or code == 403:
        raise LLMError(f"The provider rejected the key (HTTP {code}). "
                       f"{_tidy(detail) or 'Check it was copied in full.'}") from cause

    if code == 402:
        # DeepSeek and several others use 402 for "no money on the account".
        raise LLMError(f"The account has no credit left. {_tidy(detail)} "
                       "Top it up and try again.".replace("  ", " ")) from cause

    if code == 404:
        raise LLMError(f"Model not found. {_tidy(detail)} "
                       "Press Fetch models to see what this provider "
                       "serves.".replace("  ", " ")) from cause

    if code == 429:
        # 429 is overloaded: providers use it both for "you have no credit" and
        # for "you are going too fast", and the two have completely different
        # fixes. Rate-limit wording is checked FIRST because it is the more
        # specific signal — Gemini's free-tier throttle reads "Quota exceeded
        # for quota metric 'requests per minute'", which contains the word
        # quota and would otherwise be reported as a billing problem when the
        # actual fix is to wait sixty seconds.
        rate_limited = any(w in low for w in (
            "per minute", "per day", "per second", "per hour", "rpm", "tpm",
            "requests per", "tokens per", "too many requests", "rate limit",
            "concurrent", "slow down"))
        out_of_credit = any(w in low for w in (
            "billing", "balance", "credit", "insufficient", "payment",
            "exceeded your current quota", "spending limit", "purchase"))

        if rate_limited and not out_of_credit:
            raise LLMError(f"Too many requests — slow down. {_tidy(detail)} "
                           "Wait a moment and retry.".replace("  ", " ")) from cause
        if out_of_credit:
            raise LLMError(
                f"Out of credit or quota. {_tidy(detail)} This is a billing "
                "problem rather than a speed limit — add credit or enable "
                "billing on the account.".replace("  ", " ")) from cause
        # Genuinely ambiguous: say so, and give the provider's words rather
        # than picking one of the two and being wrong half the time.
        raise LLMError(
            f"The provider returned 429. {_tidy(detail)} That usually means "
            "either no credit on the account or too many requests too "
            "quickly.".replace("  ", " ")) from cause

    if code >= 500:
        raise LLMError(f"The provider is having trouble (HTTP {code}). "
                       f"{_tidy(detail)} Usually temporary.".replace("  ", " ")) from cause

    # Anthropic reports "credit balance is too low" as a 400, so the billing
    # case has to be caught here too rather than only under 429.
    if any(w in low for w in ("credit balance", "insufficient", "billing", "top up")):
        raise LLMError(f"The account has no credit left. {_tidy(detail)}") from cause
    raise LLMError(f"HTTP {code}. {_tidy(detail)}".strip()) from cause


def _post(url: str, payload: dict, headers: dict) -> dict:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, headers={
        **BASE_HEADERS, "Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        _raise_http(e.code, e.read(), e)
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise LLMError(f"Couldn't reach the provider: {e}") from e


def _style_suffix(cfg: LLMConfig) -> str:
    """The "in a way they want" part, folded into the system prompt."""
    bits = []
    if cfg.tone:
        bits.append(f"Write in a {cfg.tone} tone.")
    if cfg.length:
        bits.append({
            "short": "Be concise — noticeably shorter than a typical answer.",
            "medium": "Use a standard length.",
            "long": "Be thorough and detailed.",
        }.get(cfg.length, ""))
    if cfg.instructions:
        # Last, so an explicit instruction overrides the presets above.
        bits.append(cfg.instructions.strip())
    return (" " + " ".join(b for b in bits if b)) if bits else ""


# Why the last chat() on this request stopped: "length" when it ran out of
# max_tokens, "stop" when it finished, "" when the provider didn't say. A
# ContextVar rather than a return value so the dozens of existing callers that
# expect a plain string are untouched; a caller that cares (the CV editor, which
# must never show a half finished JSON answer) reads it straight after the call.
_LAST_FINISH: contextvars.ContextVar = contextvars.ContextVar("llm_last_finish", default="")


def last_finish_reason() -> str:
    return _LAST_FINISH.get()


def _note_finish(raw) -> None:
    r = str(raw or "").lower()
    _LAST_FINISH.set("length" if r in ("length", "max_tokens", "max_output_tokens") else r)


def chat(system: str, user: str, cfg: LLMConfig, *, max_tokens: int = 800,
         temperature: float | None = None, json_mode: bool = False) -> str:
    """One turn against the configured provider. Raises LLMError on failure —
    the caller in llm.py converts that to None so the old fallback path still
    works exactly as before."""
    system = (system or "") + _style_suffix(cfg)
    temp = cfg.temperature if temperature is None else temperature
    provider = (cfg.provider or "openai").lower()
    model = cfg.model or DEFAULT_MODELS.get(provider, "")
    base = (cfg.base_url or DEFAULT_BASES.get(provider, "")).rstrip("/")

    kind = api_kind(provider)
    _LAST_FINISH.set("")

    if kind == "openai":
        payload = {
            "model": model,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": user}],
            "max_tokens": max_tokens,
            "temperature": temp,
        }
        # Opt-in, so no existing caller changes behaviour. OpenAI-compatible
        # providers (Groq, OpenAI, OpenRouter, Mistral…) accept this and it
        # makes a small model far more likely to return parseable JSON. Some
        # compatible servers reject the field; the caller that asked for it is
        # expected to retry without.
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        data = _post(f"{base}/chat/completions", payload,
                     {"Authorization": f"Bearer {cfg.api_key}"})
        choices = data.get("choices") or []
        if not choices:
            raise LLMError("The provider returned no choices.")
        _note_finish(choices[0].get("finish_reason"))
        return (choices[0].get("message", {}).get("content") or "").strip()

    if kind == "anthropic":
        data = _post(f"{base}/messages", {
            "model": model,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "max_tokens": max_tokens,
            "temperature": temp,
        }, {"x-api-key": cfg.api_key, "anthropic-version": "2023-06-01"})
        parts = data.get("content") or []
        _note_finish(data.get("stop_reason"))
        return "".join(p.get("text", "") for p in parts if isinstance(p, dict)).strip()

    if kind == "gemini":
        # Gemini takes the key as a query parameter and calls the system prompt
        # `system_instruction`; it is the one provider here that isn't shaped
        # like the others.
        url = f"{base}/models/{model}:generateContent?key={cfg.api_key}"
        data = _post(url, {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temp},
        }, {})
        cands = data.get("candidates") or []
        if not cands:
            raise LLMError("The model returned nothing — it may have blocked the prompt.")
        parts = (cands[0].get("content") or {}).get("parts") or []
        _note_finish(cands[0].get("finishReason"))
        return "".join(p.get("text", "") for p in parts).strip()

    if kind == "ollama":
        data = _post(f"{base}/api/chat", {
            "model": model,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": user}],
            "stream": False,
            "options": {"temperature": temp, "num_predict": max_tokens},
        }, {})
        _note_finish(data.get("done_reason"))
        return ((data.get("message") or {}).get("content") or "").strip()

    raise LLMError(f"Unknown provider '{cfg.provider}'.")


def chat_json(system: str, user: str, cfg: LLMConfig, **kwargs):
    """Same, but insisting on JSON and parsing it.

    Hosted models cannot be grammar-constrained the way llama.cpp can, so the
    fenced-code case has to be handled rather than assumed away.
    """
    text = chat(system + " Reply with JSON only — no prose, no code fence.",
                user, cfg, **kwargs)
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        import re
        cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}|\[.*\]", cleaned, re.S)
            if m:
                try:
                    return json.loads(m.group(0))
                except json.JSONDecodeError:
                    return None
            return None


def _get_json(url: str, headers: dict) -> dict:
    req = urllib.request.Request(url, headers={**BASE_HEADERS, **headers}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        _raise_http(e.code, e.read(), e)
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise LLMError(f"Couldn't reach the provider: {e}") from e


def list_models(cfg: LLMConfig) -> list[str]:
    """What this provider will actually serve you, right now.

    The single most useful thing here, and the reason the bundled defaults
    being wrong doesn't matter much: model names churn fast — DeepSeek moved
    from V3 to V4 and Kimi from K2 to K3 in the space of months — so any list
    hardcoded in an app is wrong within a release or two. Asking is cheap and
    never goes out of date.

    Every OpenAI-compatible provider exposes GET /models for exactly this;
    Anthropic and Gemini have their own equivalents.
    """
    mismatch = key_mismatch(cfg)
    if mismatch:
        raise LLMError(mismatch)
    provider = (cfg.provider or "openai").lower()
    kind = api_kind(provider)
    base = (cfg.base_url or DEFAULT_BASES.get(provider, "")).rstrip("/")
    if not base:
        raise LLMError("Set a base URL first.")

    if kind == "openai":
        data = _get_json(f"{base}/models", {"Authorization": f"Bearer {cfg.api_key}"})
        rows = data.get("data") or data.get("models") or []
        names = [r.get("id") or r.get("name") for r in rows if isinstance(r, dict)]
    elif kind == "anthropic":
        data = _get_json(f"{base}/models",
                         {"x-api-key": cfg.api_key, "anthropic-version": "2023-06-01"})
        names = [r.get("id") for r in (data.get("data") or []) if isinstance(r, dict)]
    elif kind == "gemini":
        data = _get_json(f"{base}/models?key={cfg.api_key}", {})
        # Gemini returns "models/gemini-2.0-flash"; the request wants the tail.
        names = [str(r.get("name", "")).split("/")[-1] for r in (data.get("models") or [])
                 if isinstance(r, dict) and "generateContent" in (r.get("supportedGenerationMethods") or [])]
    elif kind == "ollama":
        data = _get_json(f"{base}/api/tags", {})
        names = [r.get("name") for r in (data.get("models") or []) if isinstance(r, dict)]
    else:
        raise LLMError(f"Unknown provider '{cfg.provider}'.")

    # Embedding, moderation, audio and image models can't hold a conversation,
    # and a list with 200 of them in it is not a list anyone will read.
    skip = ("embed", "embedding", "moderation", "whisper", "tts", "dall-e",
            "image", "rerank", "audio", "realtime", "transcribe")
    chat_models = [n for n in names if n and not any(s in n.lower() for s in skip)]
    return sorted(set(chat_models))


# Key prefixes that identify a provider on sight. Only the distinctive ones
# are listed: OpenAI, DeepSeek and Moonshot all issue `sk-…`, so a bare sk- key
# says nothing and must not be guessed at.
KEY_PREFIXES = [
    ("sk-ant-", "anthropic"),
    ("sk-or-v1-", "openrouter"),
    ("gsk_", "groq"),
    ("xai-", "xai"),
    ("pplx-", "perplexity"),
    ("AIza", "gemini"),
    ("fw_", "fireworks"),
    ("csk-", "cerebras"),
]


def provider_from_key(api_key: str) -> str | None:
    """Which provider issued this key, when the prefix makes it obvious."""
    key = (api_key or "").strip()
    for prefix, provider in KEY_PREFIXES:
        if key.startswith(prefix):
            return provider
    return None


def key_mismatch(cfg: LLMConfig) -> str | None:
    """A human explanation when the key clearly belongs to another provider.

    Worth its own check because two of these are genuinely easy to confuse:
    **Groq** (an inference host, keys `gsk_…`) and **Grok** (xAI's model, keys
    `xai-…`) differ by one letter. Sending a Groq key to api.x.ai gets a bare
    401, which reads as "my key is broken" rather than "wrong provider
    selected" — and the person then goes and regenerates a perfectly good key.
    """
    guessed = provider_from_key(cfg.api_key)
    chosen = (cfg.provider or "").lower()
    if not guessed or guessed == chosen:
        return None
    names = {k: v["label"] for k, v in PROVIDERS.items()}
    hint = ""
    if {guessed, chosen} == {"groq", "xai"}:
        hint = (" Groq and Grok are different companies with nearly the same "
                "name: Groq is an inference host, Grok is xAI's model.")
    return (f"That key looks like a {names.get(guessed, guessed)} key "
            f"(it starts with '{cfg.api_key.strip()[:4]}…'), but "
            f"{names.get(chosen, chosen)} is selected.{hint} "
            f"Switch the provider to {names.get(guessed, guessed)}.")


def test_config(cfg: LLMConfig) -> dict:
    """A one-token round trip, so a wrong key is discovered while somebody is
    looking at the settings page rather than three screens later when a cover
    letter comes back empty."""
    mismatch = key_mismatch(cfg)
    if mismatch:
        return {"ok": False, "error": mismatch}
    try:
        reply = chat("You are a connection test.", "Reply with exactly: OK",
                     cfg, max_tokens=16, temperature=0)
        return {"ok": True, "reply": (reply or "")[:120],
                "model": cfg.model or DEFAULT_MODELS.get(cfg.provider, "")}
    except LLMError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:  # a provider returning something unexpected
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
