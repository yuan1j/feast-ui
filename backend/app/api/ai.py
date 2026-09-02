"""
AI assistant HTTP endpoints.

  * GET  /backend/ai/config  - public AI settings for the browser (no secrets)
  * POST /backend/ai/chat    - SSE streamed chat (agent loop in services.agent)

Request body for /chat:
    {"messages": [{"role": "user", "content": "..."}], "model": "qwen3-LLM"}

SSE events (see services/agent.py):
    tool_call / delta / done / error
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..core.config import build_config
from ..services.agent import run_agent

_config = build_config()
_AI = _config["ai"]

router = APIRouter(prefix="/backend/ai", tags=["ai"])


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(system|user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(..., min_length=1)
    model: Optional[str] = None


@router.get("/config")
async def ai_config() -> Dict[str, Any]:
    """Public AI configuration the browser needs (no secrets)."""
    return {
        "enabled": bool(_AI.get("endpoint")),
        "defaultModel": _AI.get("defaultModel") or "",
        "models": _AI.get("models") or [],
        "maxToolRounds": _AI.get("maxToolRounds") or 5,
        "authType": (_AI.get("auth") or {}).get("type") or "none",
    }


@router.post("/chat")
async def chat(payload: ChatRequest) -> StreamingResponse:
    messages = [{"role": m.role, "content": m.content} for m in payload.messages]
    return StreamingResponse(
        run_agent(messages, payload.model),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
