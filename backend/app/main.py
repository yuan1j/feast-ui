"""
Feast UI backend - single FastAPI service that fixes all CORS issues.

  * /api/v1/*                 -> Feast REST Registry Server (default 127.0.0.1:6572)
  * /backend/api/registry/*   -> Registry tools (same registry, /backend prefix)
  * /backend/api/online/*     -> Online Serving API tools (default 127.0.0.1:8000)
  * /backend/ai/config        -> public AI settings for the browser
  * /backend/ai/chat          -> LLM assistant (SSE stream; agent loop is here)
  * /health                   -> health check

Start it with:
    cd backend
    python -m uvicorn app.main:app --host 0.0.0.0 --port 8001
or simply:
    python run.py
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import ai, online, registry
from .core.config import build_config
from .core.proxy import close_client

_config = build_config()

ENV_DOCS = [
    ("BACKEND_PORT", "HTTP listen port", "8001"),
    ("REGISTRY_URL", "Feast REST Registry Server", "http://127.0.0.1:6572"),
    ("ONLINE_URL", "Feast Online Serving API", "http://127.0.0.1:8000"),
    ("CORS_ORIGINS", "Allowed origins, comma separated", "*"),
    ("AI_ENDPOINT", "LLM chat completions URL (alias: AI_LLM_ENDPOINT)", ".env"),
    ("AI_DEFAULT_MODEL", "Default model name", ".env"),
    ("AI_MODELS", "Comma-separated selectable models", ".env"),
    ("AI_LLM_USER", "Value for the request user field", ".env"),
    ("AI_DSP_TOKEN_URL", "DSP token endpoint URL", ".env"),
    ("AI_DSP_USERNAME", "DSP username", "unset -> DSP auth incomplete"),
    ("AI_DSP_PASSWORD", "DSP password", "unset -> DSP auth incomplete"),
    ("AI_MAX_TOOL_ROUNDS", "Max tool-calling rounds", "5"),
    ("AI_MAX_TOKENS", "max_tokens for chat completions", "512"),
]


def _log_startup() -> None:
    ai_cfg = _config["ai"]
    dsp = ai_cfg.get("auth", {}).get("dsp") or {}
    missing = [n for n in ("username", "password") if not (dsp.get(n) or "")]

    print(f"\n=== Feast UI Backend (port {_config['port']}) ===")
    print(f"  Registry API : {_config['registry_url']}")
    print(f"  Online API   : {_config['online_url']}")
    print(f"  CORS origins : {', '.join(_config['cors_origins'])}")
    print(f"  LLM endpoint : {ai_cfg.get('endpoint') or '(NOT CONFIGURED)'}")
    print(f"  Default model: {ai_cfg.get('defaultModel') or '(none)'}")
    print(f"  Models       : {', '.join(ai_cfg.get('models') or []) or '(none)'}")
    print(f"  LLM user     : {ai_cfg.get('user') or '(not set)'}")
    print(f"  maxToolRounds: {ai_cfg.get('maxToolRounds') or '(not set)'}")
    print(f"  max_tokens   : {ai_cfg.get('maxTokens') or '(not set)'}")
    print(
        f"  DSP token URL: "
        f"{(ai_cfg.get('auth') or {}).get('dsp', {}).get('tokenUrl') or '(NOT CONFIGURED)'}"
    )
    if missing:
        print(
            f"  DSP creds    : missing {', '.join(missing)} -> set "
            "AI_DSP_USERNAME / AI_DSP_PASSWORD in backend/.env"
        )
    else:
        print("  DSP creds    : configured (via backend/.env)")

    warnings = []
    if not ai_cfg.get("endpoint"):
        warnings.append(
            "LLM endpoint is not configured: set AI_ENDPOINT in backend/.env - "
            "the AI assistant will be unavailable."
        )
    if not (ai_cfg.get("auth") or {}).get("dsp", {}).get("tokenUrl"):
        warnings.append(
            "DSP token URL is not configured: set AI_DSP_TOKEN_URL in "
            "backend/.env."
        )
    if missing:
        warnings.append(
            f"DSP credential(s) {', '.join(missing)} are not set: add "
            "AI_DSP_USERNAME / AI_DSP_PASSWORD to backend/.env."
        )
    if warnings:
        print("\n[WARN] Some AI parameters need configuration:")
        for w in warnings:
            print(f"  ! {w}")

    print("\nEnvironment variables / backend/.env (all optional):")
    for name, desc, default in ENV_DOCS:
        print(f"  {name:<20} {desc}  (default: {default})")
    print()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _log_startup()
    yield
    await close_client()


app = FastAPI(
    title="Feast UI Backend",
    description=(
        "CORS-safe proxy for the Feast Registry Server and the Online Serving "
        "API, plus the LLM assistant backend (DSP token + OpenAI streaming)."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_config["cors_origins"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(registry.router)
app.include_router(registry.v1_router)
app.include_router(online.router)
app.include_router(ai.router)


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse(
        {
            "status": "ok",
            "registry": _config["registry_url"],
            "online": _config["online_url"],
            "ai_enabled": bool(_config["ai"].get("endpoint")),
        }
    )
