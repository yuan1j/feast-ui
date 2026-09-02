"""
LLM-powered feature platform assistant - the agent loop (service layer).

The browser never needs to know the LLM endpoint, the DSP token URL, the API
key or any other AI/registry parameter:

  1. Acquire a DSP token from auth.dsp.tokenUrl (cached until expiry).
  2. Call the OpenAI-compatible chat completions endpoint (placeholder api_key,
     TLS via httpx + the OS trust store) with the function-calling tools.
  3. When the model asks for a tool, execute it against the registry / online
     backends through this FastAPI service.
  4. Stream every text delta and every tool result to the browser as SSE.

SSE events produced by run_agent():
  * tool_call - {"name", "args", "ok", "status", "data"|"error"}
  * delta     - {"content": "<text chunk>"}
  * done      - {"answer", "toolCalls"}
  * error     - {"message"}
"""
from __future__ import annotations

import json
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
from openai import AsyncOpenAI

from ..core.config import build_config
from ..core.proxy import call_backend, get_ssl_context
from .dsp import get_dsp_token
from .tool_specs import TOOL_DEFS, TOOL_SPECS

_config = build_config()
_AI = _config["ai"]
REGISTRY_URL = _config["registry_url"]
ONLINE_URL = _config["online_url"]

SYSTEM_PROMPT = """You are the assistant for FCIS, a feature platform built on Feast, the open-source feature store. You can query real data from the feature platform backend by calling the tools provided to you.

How to pick the right Feast API (tools) for a user question:
1. If the user asks about a specific project, first call list_projects to get real project names, then pass the matching project name to list/filter tools (e.g. list_feature_views with project). Never invent a project name.
2. List vs details: use list_* to enumerate resources; use get_* to inspect a specific resource. When a resource name is unknown, list first, then get details.
3. Search: for keyword queries across resource types, use search_resources; for the online store use search_online.
4. Lineage: use list_lineage_objects (single object) or list_lineage_complete (whole registry).
5. Monitoring/quality: use get_monitoring_features / get_monitoring_feature_views / get_monitoring_timeseries.
6. Materialization: use list_materialization_jobs for jobs; use materialize_online / materialize_incremental_online to materialize.
7. Online / real-time: use get_online_features to retrieve online feature values; use list_vector_stores / search_vector_store for vector similarity search; use push_data / write_to_online_store to write real-time data.
8. Counts/tags/recents: use get_resource_counts / get_popular_tags / get_recently_visited.
9. Multiple steps are allowed: run the tools you need, then summarize from the real results.

Answering rules:
1. Answer ONLY based on the real data returned by the tools. Reference actual names, counts, and projects in your answers. Keep answers concise and clear.
2. If the user's question cannot be answered with the available tools, or is outside the scope of the feature platform, reply honestly with "Sorry, I cannot answer this question" or "I don't have this information". Never guess, speculate, or fabricate answers.
3. When a tool returns an empty list, say so truthfully (e.g. "No matching data was found"). Do not invent resources that do not exist.
4. Answer in the same language the user used."""

_client: Optional[AsyncOpenAI] = None


def _new_uuid() -> str:
    return str(uuid.uuid4())


def _build_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        endpoint = _AI.get("endpoint") or ""
        if not endpoint:
            raise RuntimeError(
                "AI endpoint is not configured: set AI_ENDPOINT in backend/.env."
            )
        # TLS via httpx + the OS trust store (needed for HSBC internal gateways).
        # The OpenAI SDK accepts any httpx.AsyncClient. The SDK (>=2.x) requires
        # a non-empty api_key, but real auth is handled by the DSP token header
        # (X-HSBC-E2E-Trust-Token) injected below, so a placeholder key is used.
        http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(120.0, connect=30.0),
            verify=get_ssl_context(),
        )
        _client = AsyncOpenAI(
            api_key="empty",  # placeholder: authentication is via the DSP token
            base_url=endpoint,
            http_client=http_client,
            max_retries=2,
        )
    return _client


async def _auth_headers() -> Dict[str, str]:
    auth = _AI.get("auth") or {}
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if (auth.get("type") or "none") == "dsp":
        token = await get_dsp_token()
        if token:
            headers[auth.get("headerName") or "X-HSBC-E2E-Trust-Token"] = (
                str(auth.get("headerPrefix") or "") + token
            )
    elif (auth.get("type") or "none") == "fixed":
        key = str(auth.get("apiKey") or "")
        if key:
            headers[auth.get("headerName") or "Authorization"] = (
                str(auth.get("headerPrefix") or "") + key
            )
    return headers


def _resolve_path(spec: Dict[str, Any], args: Dict[str, Any]) -> str:
    path: str = spec["path"]
    for key, value in args.items():
        path = path.replace(f":{key}", str(value))
    return path


def _clean_params(params: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in params.items() if v is not None and v != ""}


async def execute_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Run one tool against the registry / online backends."""
    spec = TOOL_SPECS.get(name)
    if not spec:
        raise RuntimeError(f"Unknown tool: {name}")

    query: Dict[str, Any] = {}
    if spec.get("query"):
        query = _clean_params(spec["query"](args))

    json_body: Any = None
    if spec.get("json_body"):
        json_body = spec["json_body"](args)

    # The /xxx/all endpoints do not accept a project parameter: when the model
    # did not specify a project, fall back to the "all" endpoint.
    has_project = bool(query.get("project") and str(query.get("project")).strip())
    path = _resolve_path(spec, args)
    if spec.get("all_path") and not has_project:
        path = spec["all_path"]
        query.pop("project", None)

    if spec["kind"] == "online":
        base = ONLINE_URL
        full_path = path
    else:
        base = REGISTRY_URL
        full_path = f"/api/v1{path}"

    method = spec.get("method") or "GET"
    status, data = await call_backend(
        method, base, full_path, params=query or None, json_body=json_body
    )
    if status >= 400:
        detail = data if isinstance(data, str) else json.dumps(data)[:300]
        raise RuntimeError(f"Backend API {status}: {detail}")
    return {"status": status, "data": data}


async def _run_tool_and_report(
    call: Dict[str, Any],
) -> Dict[str, Any]:
    name = call.get("function", {}).get("name", "")
    try:
        args = json.loads(call.get("function", {}).get("arguments") or "{}")
    except json.JSONDecodeError:
        args = {}
    info: Dict[str, Any] = {"name": name, "args": args, "ok": False}
    try:
        result = await execute_tool(name, args)
        info["ok"] = True
        info["status"] = result.get("status")
        info["data"] = result.get("data")
    except Exception as exc:  # noqa: BLE001 - report any tool failure to the model
        info["error"] = str(exc)
    return info


def sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def run_agent(
    messages: List[Dict[str, Any]],
    model: Optional[str],
) -> AsyncIterator[str]:
    """Agent loop producing SSE event strings."""
    tool_calls_done: List[Dict[str, Any]] = []
    client = _build_client()
    model_name = model or _AI.get("defaultModel") or "qwen3-LLM"
    max_rounds = int(_AI.get("maxToolRounds") or 5)
    max_tokens = int(_AI.get("maxTokens") or 512)
    user_field = _AI.get("user")

    history: List[Dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *messages,
    ]

    for _round in range(max_rounds):
        request_id = _new_uuid()
        extra_headers: Dict[str, str] = {}
        for k, v in (_AI.get("extraHeaders") or {}).items():
            extra_headers[str(k)] = str(v).replace("{{uuid}}", request_id)

        try:
            headers = await _auth_headers()
            headers.update(extra_headers)
        except Exception as exc:  # noqa: BLE001
            yield sse(
                "error",
                {
                    "message": (
                        "Authentication failed. Please check the DSP "
                        f"configuration: {exc}"
                    )
                },
            )
            return

        kwargs: Dict[str, Any] = {
            "model": model_name,
            "messages": history,
            "tools": TOOL_DEFS,
            "temperature": 0.2,
            "stream": True,
            "extra_headers": headers,
            "max_tokens": max_tokens,
        }
        if user_field:
            kwargs["user"] = str(user_field)

        try:
            stream = await client.chat.completions.create(**kwargs)
        except Exception as exc:  # noqa: BLE001
            yield sse("error", {"message": f"LLM API error: {exc}"})
            return

        assistant_msg: Dict[str, Any] = {
            "role": "assistant",
            "content": "",
            "tool_calls": [],
        }
        tool_acc: Dict[int, Dict[str, Any]] = {}
        content_chunks: List[str] = []

        try:
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta is None:
                    continue
                if delta.content:
                    content_chunks.append(delta.content)
                    yield sse("delta", {"content": delta.content})
                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        acc = tool_acc.setdefault(
                            idx,
                            {
                                "id": "",
                                "type": "function",
                                "function": {"name": "", "arguments": ""},
                            },
                        )
                        if tc.id:
                            acc["id"] = tc.id
                        if tc.function:
                            if tc.function.name:
                                acc["function"]["name"] += tc.function.name
                            if tc.function.arguments:
                                acc["function"]["arguments"] += tc.function.arguments
        except Exception as exc:  # noqa: BLE001
            yield sse("error", {"message": f"LLM stream interrupted: {exc}"})
            return

        assistant_msg["content"] = "".join(content_chunks) or None
        assistant_msg["tool_calls"] = list(tool_acc.values())

        if not assistant_msg["tool_calls"]:
            answer = "".join(content_chunks).strip() or (
                "Sorry, I cannot answer this question."
            )
            yield sse(
                "done",
                {"answer": answer, "toolCalls": tool_calls_done},
            )
            return

        # The model requested tool calls: run them and feed the results back.
        history.append(assistant_msg)
        for call in assistant_msg["tool_calls"]:
            info = await _run_tool_and_report(call)
            tool_calls_done.append(info)
            if info["ok"]:
                history.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id"),
                        "content": json.dumps(info.get("data"), ensure_ascii=False),
                    }
                )
            else:
                history.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id"),
                        "content": json.dumps({"error": info.get("error")}),
                    }
                )
            yield sse("tool_call", info)

    yield sse(
        "done",
        {
            "answer": "Sorry, I could not reach a clear conclusion after multiple "
            "rounds of queries. Please try rephrasing your question.",
            "toolCalls": tool_calls_done,
        },
    )
