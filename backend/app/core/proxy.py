"""
Shared httpx-based proxy helpers used by the registry / online routers and the
AI agent's tool executor. Every outbound call goes through one AsyncClient.
"""
from __future__ import annotations

import json
from typing import Any, Optional

import httpx
from fastapi import Request, Response

_client: Optional[httpx.AsyncClient] = None
_SSL_CONTEXT = None


def get_ssl_context():
    """Create a default SSL context with the OS trust store injected."""
    global _SSL_CONTEXT
    if _SSL_CONTEXT is None:
        import ssl

        try:
            import truststore

            _SSL_CONTEXT = ssl.create_default_context()
            truststore.inject_into_ssl_context(_SSL_CONTEXT)
        except Exception:
            # truststore missing or failed: fall back to the default context
            _SSL_CONTEXT = ssl.create_default_context()
    return _SSL_CONTEXT


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        # `verify` accepts an ssl.SSLContext: certificates trusted by the OS are
        # honoured (needed for the internal HSBC DSP / AI gateways).
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(120.0, connect=30.0),
            verify=get_ssl_context(),
        )
    return _client


async def close_client():
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def proxy_request(
    base_url: str,
    path: str,
    request: Request,
    prefix_to_strip: str = "",
    timeout: Optional[float] = None,
) -> Response:
    """
    Forward an incoming request to {base_url}/{path} preserving the method,
    query string, headers and body. `prefix_to_strip` (e.g. "/backend/api/registry")
    is removed from `path` if it is currently mounted under that prefix.
    """
    client = get_client()
    if prefix_to_strip:
        path = path.replace(prefix_to_strip, "", 1)
    target = f"{base_url}/{path.lstrip('/')}"

    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in ("host", "connection", "content-length")
    }

    body = await request.body()
    try:
        resp = await client.request(
            request.method,
            target,
            headers=headers,
            content=body or None,
            params=request.query_params,
            timeout=timeout,
        )
    except httpx.HTTPError as exc:
        return Response(
            content=json.dumps({"detail": f"Proxy error: {exc}"}),
            status_code=502,
            media_type="application/json",
        )

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
        headers={
            k: v
            for k, v in resp.headers.items()
            if k.lower() not in ("transfer-encoding", "content-encoding")
        },
    )


async def call_backend(
    method: str,
    base_url: str,
    path: str,
    params: Optional[dict] = None,
    json_body: Any = None,
    headers: Optional[dict] = None,
    timeout: Optional[float] = 60.0,
) -> tuple[int, Any]:
    """Programmatic call used by the AI agent's tool executor."""
    client = get_client()
    try:
        resp = await client.request(
            method,
            f"{base_url}/{path.lstrip('/')}",
            params=params,
            json=json_body,
            headers=headers,
            timeout=timeout,
        )
    except httpx.HTTPError as exc:
        return 502, {"detail": f"Backend error: {exc}"}
    try:
        data = resp.json()
    except Exception:
        data = resp.text
    return resp.status_code, data
