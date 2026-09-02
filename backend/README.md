# Feast UI Backend (FastAPI)

A CORS-safe backend. Every AI / Registry / Online request from the frontend goes
through it, because the browser can no longer call the downstream services
directly (none of the Registry Server, Online Serving API, DSP, or LLM gateway
send CORS headers).

## Directory Structure

```
backend/
├── .env                     # Environment config (secrets are not committed; see .env.example)
├── .env.example             # Config template: copy to .env and adjust per environment
├── requirements.txt
├── run.py                   # Start with `python run.py` (port from BACKEND_PORT/.env)
└── app/
    ├── main.py              # Entry: CORS, registers all routers, /health, startup log
    ├── core/                # Infrastructure
    │   ├── config.py        # Config: shell env vars > .env > built-in defaults
    │   └── proxy.py         # httpx client / SSL(truststore) / proxy_request / call_backend
    ├── services/            # Business logic (non-HTTP, reusable and unit-testable)
    │   ├── dsp.py           # DSP token client (cached until expires_in)
    │   ├── tool_specs.py    # AI tool definitions (registry + online)
    │   └── agent.py         # AI agent loop: DSP token + OpenAI streaming + tool execution + SSE
    └── api/                 # HTTP endpoint layer, one file per downstream service for easy extension
        ├── registry.py      # /backend/api/registry/* and /api/v1/* -> Registry Server
        ├── online.py        # /backend/api/online/*    -> Online Serving API
        └── ai.py            # /backend/ai/config and /backend/ai/chat
```

To add a new API, create a router file under `app/api/` and call
`include_router` in `app/main.py`; put shared logic in `app/core/` and business
logic in `app/services/`.

## Configuration (.env)

All configurable items are centralized in `backend/.env` (copy from
`.env.example`). Precedence: **shell env vars > .env > built-in defaults**.
Keep a separate `.env` per environment (local / UAT / production).

| Variable | Description | Default |
|----------|-------------|---------|
| `BACKEND_PORT` | HTTP port | `8001` |
| `REGISTRY_URL` | Feast REST Registry Server | `http://127.0.0.1:6572` |
| `ONLINE_URL` | Feast Online Serving API | `http://127.0.0.1:8000` |
| `CORS_ORIGINS` | Allowed origins, comma-separated (`*` = all) | `*` |
| `AI_ENDPOINT` | LLM chat completions URL | built-in default |
| `AI_DEFAULT_MODEL` | Default model | built-in default |
| `AI_MODELS` | Selectable models, comma-separated | built-in default |
| `AI_LLM_USER` | Value for the request `user` field | built-in default |
| `AI_DSP_TOKEN_URL` | DSP token endpoint | built-in default |
| `AI_DSP_USERNAME` | DSP username | empty (DSP auth unavailable) |
| `AI_DSP_PASSWORD` | DSP password | empty (DSP auth unavailable) |
| `AI_MAX_TOOL_ROUNDS` | Max tool-calling rounds | `5` |
| `AI_MAX_TOKENS` | `max_tokens` per answer | `512` |

## Startup

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env        # first time: fill in per environment (at least AI_DSP_USERNAME / AI_DSP_PASSWORD)
python run.py               # default port 8001
```

Or: `uvicorn app.main:app --host 0.0.0.0 --port 8001`.
The startup log prints the currently effective config and warnings for missing items.

## API Overview

| Path | Description |
|------|-------------|
| `GET /health` | Health check |
| `/api/v1/*` | Standard Feast UI page data → Registry Server |
| `/backend/api/registry/*` | Registry tools (same registry, `/backend` prefix) |
| `/backend/api/online/*` | Online Serving API tools |
| `GET /backend/ai/config` | Browser-facing AI settings (no secrets) |
| `POST /backend/ai/chat` | LLM assistant SSE stream. body: `{"messages":[{"role":"user","content":"..."}],"model":"..."}` |

AI chat SSE events:

```
event: tool_call  data: {"name","args","ok","status","data"|"error"}
event: delta      data: {"content": "<text chunk>"}
event: done       data: {"answer","toolCalls"}
event: error      data: {"message"}
```

## Working with the Frontend

- Development mode: start with `cd backend && python run.py`, then `yarn start`
  (`setupProxy.js` forwards `/api/v1` and `/backend` to `127.0.0.1:8001`).
- Production mode: `node server.js` (serves static `build/` + forwards
  `/api/v1` and `/backend` to FastAPI), or serve `frontend/build` directly from FastAPI.

## Notes

- AI uses the `openai` SDK (the `api_key` is a placeholder). TLS is built with
  `httpx` + `ssl` + `truststore` (system certificate store) to satisfy the HSBC
  internal gateway requirements.
- The DSP token is cached by `expires_in` and refreshed automatically when expired.
- Tool calls (registry / online) are all executed inside the FastAPI backend; the
  frontend only sends messages and receives the stream.
