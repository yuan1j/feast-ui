"""
Runtime configuration for the Feast UI backend.

Configuration precedence:
  1. Environment variables (highest priority).
  2. backend/.env (different environments use different .env files,
     e.g. .env.local / .env.uat / .env.prod copied to .env).
  3. Built-in defaults below (the AI defaults previously shipped in
     frontend/public/ai-config.json are now inline here - the frontend talks
     to the backend APIs only, it never reads that file).

The .env file lives next to run.py (backend/.env). Create it from the example:

    cp .env.example .env        # then fill in the values

All values in the environment / .env override the built-in defaults.
DSP credentials in AI_DSP_USERNAME / AI_DSP_PASSWORD replace the
{{username}} / {{password}} placeholders inside the DSP token body.
"""
from __future__ import annotations

import copy
import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    def _load_env(path: Path) -> None:
        """Use python-dotenv when available (never overrides existing env vars)."""
        load_dotenv(path, override=False)

except ImportError:

    def _load_env(path: Path) -> None:
        """Minimal built-in .env loader: KEY=VALUE lines, '#' comments."""
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return
        for raw in lines:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


# core/config.py -> app/ -> backend/
_BACKEND_DIR = Path(__file__).resolve().parents[2]

# Load backend/.env. Never overrides already-set environment variables, which
# gives us the precedence: shell env var > .env > built-in defaults.
_load_env(_BACKEND_DIR / ".env")

DEFAULT_AI_CONFIG: dict = {
    "endpoint": (
        "https://gaip-api.gaipuat.dev.ali.cloud.cn.hsbc"
        "/etiv-ssvc-aigateway-ea-chatcompletion-uat-internal-proxy"
        "/v1/api/v1/chat/completions"
    ),
    "defaultModel": "qwen3-LLM",
    "models": ["qwen3-LLM"],
    "maxToolRounds": 5,
    "maxTokens": 512,
    "user": "UC0008739",
    "extraHeaders": {
        "x-correlation-id": "{{uuid}}",
        "x-usersession-id": "{{uuid}}",
    },
    "auth": {
        "type": "dsp",
        "apiKey": "",
        "headerName": "X-HSBC-E2E-Trust-Token",
        "headerPrefix": "",
        "dsp": {
            "tokenUrl": (
                "https://cmb-ib2b-dsp-pprod-eu.systems.uk.hsbc:8443"
                "/dsp/rest-sts/DSP_iB2B/iB2B_tokenTranslator?=&_action=translate"
            ),
            "username": "",
            "password": "",
        },
    },
}


def build_config(env=os.environ) -> dict:
    ai = copy.deepcopy(DEFAULT_AI_CONFIG)

    # --- backend basics ---------------------------------------------------
    config = {
        "port": int(env.get("BACKEND_PORT") or 8001),
        "registry_url": (env.get("REGISTRY_URL") or "http://127.0.0.1:6572").rstrip(
            "/"
        ),
        "online_url": (env.get("ONLINE_URL") or "http://127.0.0.1:8000").rstrip("/"),
        "cors_origins": [
            o.strip()
            for o in (env.get("CORS_ORIGINS") or "*").split(",")
            if o.strip()
        ],
    }

    # --- AI overrides (env/.env wins over built-in defaults) ---------------
    endpoint = env.get("AI_ENDPOINT") or env.get("AI_LLM_ENDPOINT")
    if endpoint:
        ai["endpoint"] = endpoint
    if env.get("AI_DEFAULT_MODEL"):
        ai["defaultModel"] = env["AI_DEFAULT_MODEL"]
    if env.get("AI_MODELS"):
        models = [m.strip() for m in env["AI_MODELS"].split(",") if m.strip()]
        if models:
            ai["models"] = models
    if env.get("AI_LLM_USER"):
        ai["user"] = env["AI_LLM_USER"]
    if env.get("AI_DSP_TOKEN_URL"):
        ai.setdefault("auth", {}).setdefault("dsp", {})["tokenUrl"] = env[
            "AI_DSP_TOKEN_URL"
        ]

    def _to_non_neg_int(v):
        try:
            n = int(v)
            return n if n >= 0 else None
        except (TypeError, ValueError):
            return None

    max_rounds = _to_non_neg_int(env.get("AI_MAX_TOOL_ROUNDS"))
    if max_rounds is not None:
        ai["maxToolRounds"] = max_rounds
    max_tokens = _to_non_neg_int(env.get("AI_MAX_TOKENS"))
    if max_tokens is not None:
        ai["maxTokens"] = max_tokens

    # DSP credentials come straight from the environment so the backend never
    # needs the browser to send them.
    dsp = ai.get("auth", {}).get("dsp") or {}
    if env.get("AI_DSP_USERNAME"):
        dsp["username"] = env["AI_DSP_USERNAME"]
    if env.get("AI_DSP_PASSWORD"):
        dsp["password"] = env["AI_DSP_PASSWORD"]

    config["ai"] = ai
    return config
