"""
Feast Registry Server tools (backend).

Exposes the Feast REST Registry Server (default http://127.0.0.1:6572) to the
frontend through two mounting points:

  * GET/POST/DELETE /backend/api/registry/*  ->  {REGISTRY_URL}/api/v1/*
    (used by the AI agent tools and by custom frontend pages)
  * GET/POST/DELETE /api/v1/*                ->  {REGISTRY_URL}/api/v1/*
    (same registry, kept at the original path so the standard Feast UI pages
     keep working unchanged)

The Registry Server does not send CORS headers, so the browser can never call
it directly; every request must go through this FastAPI backend.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import Response

from ..core.config import build_config
from ..core.proxy import proxy_request

_config = build_config()
REGISTRY_URL = _config["registry_url"]

router = APIRouter(prefix="/backend/api/registry", tags=["registry"])


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def registry_tools(path: str, request: Request) -> Response:
    """Forward /backend/api/registry/* to the registry server under /api/v1."""
    return await proxy_request(
        REGISTRY_URL,
        f"/api/v1/{path}",
        request,
        prefix_to_strip="/backend/api/registry",
    )


# ---------------------------------------------------------------------------
# Original-path router: /api/v1/* -> {REGISTRY_URL}/api/v1/*
# ---------------------------------------------------------------------------
v1_router = APIRouter(prefix="/api/v1", tags=["registry-v1"])


@v1_router.api_route(
    "/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"]
)
async def registry_v1(path: str, request: Request) -> Response:
    return await proxy_request(REGISTRY_URL, f"/api/v1/{path}", request)


# Convenience alias so the AI agent can resolve registry targets too.
def registry_base_url() -> str:
    return REGISTRY_URL
