"""
DSP (token-based) authentication client.

Fetches a JWT from the configured DSP "token translator" endpoint and caches it
until it expires, so the AI gateway can be called with
`X-HSBC-E2E-Trust-Token: <jwt>`.

The request body is fixed (JSON credential exchange); the endpoint and
credentials come from the configuration (`auth.dsp.tokenUrl` /
`AI_DSP_USERNAME` / `AI_DSP_PASSWORD`). All TLS is done with httpx + the OS
trust store (truststore), which is what the internal HSBC gateways require.
"""
from __future__ import annotations

import json
import time
from typing import Any, Dict, Optional

from ..core.config import build_config
from ..core.proxy import get_client

_config = build_config()
_AI = _config["ai"]

# Body sent to the DSP token translator (credentials filled from config).
_DSP_BODY = {
    "input_token_state": {
        "token_type": "CREDENTIAL",
        "username": "",
        "password": "",
    },
    "output_token_state": {"token_type": "JWT"},
}

_cache: Dict[str, Any] = {"token": None, "expires_at": 0.0}
_lock: Optional[Any] = None


def _get_lock():
    global _lock
    if _lock is None:
        import asyncio

        _lock = asyncio.Lock()
    return _lock


async def get_dsp_token(force: bool = False) -> str:
    """Return a valid DSP token, acquiring and caching it if needed."""
    dsp: dict = (_AI.get("auth") or {}).get("dsp") or {}
    token_url = dsp.get("tokenUrl") or ""
    if not token_url:
        raise RuntimeError(
            "DSP authentication is enabled but 'auth.dsp.tokenUrl' is not configured."
        )

    async with _get_lock():
        # Reuse the cached token while it still has 30s of life left.
        if (
            not force
            and _cache["token"]
            and _cache["expires_at"] > time.time() + 30
        ):
            return _cache["token"]

        body = dict(_DSP_BODY)
        body["input_token_state"]["username"] = str(dsp.get("username") or "")
        body["input_token_state"]["password"] = str(dsp.get("password") or "")

        client = get_client()
        try:
            resp = await client.request(
                "POST",
                token_url,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                content=json.dumps(body),
                timeout=60.0,
            )
        except Exception as exc:  # httpx.HTTPError, ssl errors...
            raise RuntimeError(f"DSP token request failed: {exc}") from exc

        if resp.status_code >= 400:
            raise RuntimeError(
                f"DSP token request failed ({resp.status_code}): "
                f"{resp.text[:300]}"
            )

        try:
            payload = resp.json()
        except Exception:
            payload = {}

        token = payload.get("issued_token")
        if not token or not isinstance(token, str):
            raise RuntimeError(
                f"DSP token response has no 'issued_token'. "
                f"Received: {json.dumps(payload)[:300]}"
            )

        try:
            expires_in = int(payload.get("expires_in") or 0)
        except (TypeError, ValueError):
            expires_in = 0

        _cache["token"] = token
        _cache["expires_at"] = (
            time.time() + expires_in if expires_in > 0 else time.time() + 10 * 60
        )
        return token
