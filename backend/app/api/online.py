"""
Feast Online Serving API tools (backend).

Exposes the Feast Online Serving API (default http://127.0.0.1:8000) to the
frontend through /backend/api/online/*. Endpoints include:

  * /get-online-features       - online feature retrieval (POST)
  * /search                    - full text search (GET)
  * /v1/vector_stores          - list / manage vector stores (GET/POST)
  * /v1/vector_stores/{id}     - vector store details (GET/DELETE)
  * /v1/vector_stores/{id}/search - vector similarity search (POST)
  * /push                      - push data to the online store (POST)
  * /write-to-online-store     - write features to the online store (POST)
  * /materialize / /materialize-incremental - materialization (POST)

The Online Serving API does not send CORS headers, so the browser can never
call it directly; every request must go through this FastAPI backend.
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import Response

from ..core.config import build_config
from ..core.proxy import proxy_request

_config = build_config()
ONLINE_URL = _config["online_url"]

router = APIRouter(prefix="/backend/api/online", tags=["online"])


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def online_tools(path: str, request: Request) -> Response:
    """Forward /backend/api/online/* to the online serving API."""
    return await proxy_request(
        ONLINE_URL,
        path,
        request,
        prefix_to_strip="/backend/api/online",
    )


def online_base_url() -> str:
    return ONLINE_URL
