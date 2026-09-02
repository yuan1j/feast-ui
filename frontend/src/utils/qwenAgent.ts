/**
 * Qwen Agent (LLM-powered feature platform assistant) - frontend client.
 *
 * The entire agent loop (DSP token acquisition, LLM chat completions, registry
 * / online tool execution, streaming) now runs on the FastAPI backend, so the
 * browser no longer needs to know the LLM endpoint, DSP token URL, API key or
 * any registry parameter.
 *
 * Frontend responsibilities:
 *   1. GET /backend/ai/config        -> the public AI settings (models, ...).
 *   2. POST /backend/ai/chat         -> send the conversation; the backend
 *      answers with an SSE stream:
 *         event: tool_call  data: {"name","args","ok","status","data"|"error"}
 *         event: delta      data: {"content": "<text chunk>"}
 *         event: done       data: {"answer","toolCalls"}
 *         event: error      data: {"message"}
 */

export interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

export interface AiConfig {
  enabled: boolean;
  defaultModel: string;
  models: string[];
  maxToolRounds: number;
  authType?: string;
}

export interface AgentResult {
  answer: string;
  toolCalls: ToolCallInfo[];
}

const CONFIG_PATH = "/backend/ai/config";
const CHAT_PATH = "/backend/ai/chat";

const FALLBACK_CONFIG: AiConfig = {
  enabled: false,
  defaultModel: "",
  models: [],
  maxToolRounds: 5,
};

let cachedConfig: AiConfig | null = null;

/**
 * Load the public AI configuration from the FastAPI backend.
 * Falls back to a minimal built-in config when the backend is unreachable.
 */
export const loadAiConfig = async (force = false): Promise<AiConfig> => {
  if (cachedConfig && !force) return cachedConfig;
  try {
    const res = await fetch(CONFIG_PATH, { cache: "no-store" });
    if (res.ok) {
      const raw = await res.json();
      const config: AiConfig = {
        ...FALLBACK_CONFIG,
        ...raw,
        models: Array.isArray(raw.models) ? raw.models : [],
      };
      cachedConfig = config;
      return config;
    }
  } catch {
    // backend not running yet: use fallback
  }
  cachedConfig = FALLBACK_CONFIG;
  return FALLBACK_CONFIG;
};

/** Parse a single "event: ...\ndata: ..." SSE block. */
const parseSse = (
  block: string,
): { event: string; data: any } | null => {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return { event, data: dataLines.join("\n") };
  }
};

export interface RunAgentParams {
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  onDelta?: (delta: string) => void;
  onToolCall?: (info: ToolCallInfo) => void;
  signal?: AbortSignal;
}

export const runQwenAgent = async ({
  model,
  messages,
  onDelta,
  onToolCall,
  signal,
}: RunAgentParams): Promise<AgentResult> => {
  const res = await fetch(CHAT_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model }),
    signal,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.detail || JSON.stringify(body);
    } catch {
      /* keep statusText */
    }
    throw new Error(`AI request failed (${res.status}): ${detail}`);
  }
  if (!res.body) throw new Error("AI request returned no stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const toolCalls: ToolCallInfo[] = [];
  let answer = "";
  let buffer = "";

  const flushTool = (data: any) => {
    if (!data || typeof data.name !== "string") return;
    const info: ToolCallInfo = {
      name: data.name,
      args: data.args || {},
      ok: Boolean(data.ok),
      status: data.status,
      data: data.data,
      error: data.error,
    };
    toolCalls.push(info);
    onToolCall?.(info);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const evt = parseSse(block);
      if (!evt) continue;
      switch (evt.event) {
        case "delta": {
          const content =
            typeof evt.data === "object" ? evt.data?.content : undefined;
          if (typeof content === "string") {
            answer += content;
            onDelta?.(content);
          }
          break;
        }
        case "tool_call":
          flushTool(evt.data);
          break;
        case "done": {
          if (typeof evt.data?.answer === "string") {
            answer = evt.data.answer;
          }
          if (Array.isArray(evt.data?.toolCalls)) {
            evt.data.toolCalls.forEach(flushTool);
          }
          break;
        }
        case "error": {
          const msg =
            typeof evt.data === "object" ? evt.data?.message : evt.data;
          throw new Error(String(msg || "AI request failed"));
        }
      }
    }
  }

  return { answer: answer.trim(), toolCalls };
};
