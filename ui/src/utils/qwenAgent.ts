/**
 * Qwen Agent (LLM-powered feature platform assistant)
 *
 * Pure frontend implementation - no FastAPI relay service required.
 *
 * 1. Calls an OpenAI-compatible chat completions endpoint directly from the
 *    browser (the endpoint and auth method are runtime-configurable via
 *    public/ai-config.json, so users can customize them after `npm run build`
 *    without recompiling).
 * 2. Uses Function Calling so the model decides which backend APIs to query.
 * 3. Backend APIs (default http://127.0.0.1:6572) are accessed through the
 *    /ai-backend proxy (the backend does not enable CORS).
 * 4. The model must answer only from real tool results; when it cannot answer
 *    it must say so explicitly instead of guessing.
 *
 * Auth flows:
 *   "none"  - no auth header
 *   "user"  - a credential is entered in the UI (stored in localStorage)
 *   "fixed" - a static key from the config
 *   "dsp"   - fetch a token from auth.dsp.tokenUrl first (e.g. an
 *             "issue_token" endpoint), then use that token (cached until
 *             expiry) to call the AI endpoint.
 */

export interface QwenChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

export interface AgentResult {
  answer: string;
  toolCalls: ToolCallInfo[];
}

export type AuthType = "none" | "user" | "fixed" | "dsp";

/** DSP (token-based) authentication settings */
export interface DspAuthConfig {
  /** Token endpoint, e.g. "https://your-dsp.example.com/issue_token" */
  tokenUrl: string;
  /** HTTP method for the token request, "POST" (default) or "GET" */
  tokenMethod?: "GET" | "POST";
  /** Content type of the token request body */
  tokenContentType?: "application/json" | "application/x-www-form-urlencoded";
  /**
   * Token request body. Supports {{var}} placeholders replaced at runtime:
   *   {{apiKey}}   - credential from the UI (or REACT_APP_AI_API_KEY)
   *   {{username}} / {{password}} / custom - extra credentials entered in the UI.
   * Example (username/password DSP): {"username":"{{username}}","password":"{{password}}","grantType":"password"}
   */
  tokenBody?: Record<string, unknown>;
  /** Extra headers for the token request */
  tokenHeaders?: Record<string, string>;
  /** Dot-separated JSON path of the token in the token response, default "issue_token" */
  tokenPath?: string;
  /** Dot-separated JSON path of the expiry (seconds) in the token response, default "expires_in" */
  expiresInPath?: string;
}

export interface AiConfig {
  /** OpenAI-compatible chat completions endpoint */
  endpoint: string;
  /** Default model used when the user has not selected one */
  defaultModel: string;
  /** Selectable models shown in the settings panel */
  models: string[];
  /**
   * Extra HTTP headers for the AI request, merged with the auth header.
   * Values support the {{uuid}} template (a fresh UUID per request),
   * e.g. {"x-correlation-id": "{{uuid}}", "x-usersession-id": "{{uuid}}"}
   */
  extraHeaders?: Record<string, string>;
  /**
   * Extra JSON body fields for the AI request, merged with {model, messages},
   * e.g. {"max_tokens": 150, "user": "UC0008739"}.
   * Values support {{var}} templates.
   */
  extraBody?: Record<string, unknown>;
  /**
   * Base URL prefix for the feature platform backend.
   * Also serves as the same-origin proxy for LLM / DSP requests when
   * `proxyAiRequests` is enabled: {backendBaseUrl}/llm and {backendBaseUrl}/dsp-token.
   */
  backendBaseUrl: string;
  /**
   * Route the LLM chat and DSP token requests through the same-origin backend
   * proxy ({backendBaseUrl}/llm, {backendBaseUrl}/dsp-token) instead of
   * calling the remote gateways directly. Required when the AI gateways do
   * not allow browser CORS (e.g. HSBC internal gateways).
   */
  proxyAiRequests?: boolean;
  /** Max tool-call rounds in one agent loop */
  maxToolRounds: number;
  auth: {
    type: AuthType;
    /** Fixed API key, used when auth.type === "fixed" */
    apiKey?: string;
    /** Auth header name used for the AI request, e.g. "Authorization" or "X-API-Key" */
    headerName?: string;
    /** Auth header value prefix for the AI request, e.g. "Bearer " or "" */
    headerPrefix?: string;
    /** DSP settings, used when auth.type === "dsp" */
    dsp?: DspAuthConfig;
  };
}

const DEFAULT_CONFIG: AiConfig = {
  endpoint:
    "https://gaip-api.gaipuat.dev.ali.cloud.cn.hsbc/etiv-ssvc-aigateway-ea-chatcompletion-uat-internal-proxy/v1/api/v1/chat/completions",
  defaultModel: "qwen3-LLM",
  models: ["qwen3-LLM"],
  backendBaseUrl: "/ai-backend",
  proxyAiRequests: true,
  maxToolRounds: 5,
  extraHeaders: {
    "x-correlation-id": "{{uuid}}",
    "x-usersession-id": "{{uuid}}",
  },
  extraBody: {
    max_tokens: 150,
    user: "UC0008739",
  },
  auth: {
    type: "dsp",
    apiKey: "",
    headerName: "X-HSBC-E2E-Trust-Token",
    headerPrefix: "",
    dsp: {
      tokenUrl:
        "https://cmb-ib2b-dsp-pprod-eu.systems.uk.hsbc:8443/dsp/rest-sts/DSP_iB2B/iB2B_tokenTranslator?=&_action=translate",
      tokenMethod: "POST",
      tokenContentType: "application/json",
      tokenBody: {
        input_token_state: {
          token_type: "CREDENTIAL",
          username: "{{username}}",
          password: "{{password}}",
        },
        output_token_state: {
          token_type: "JWT",
        },
      },
      tokenHeaders: {},
      tokenPath: "issued_token",
      expiresInPath: "expires_in",
    },
  },
};

const CONFIG_PATH = `${process.env.PUBLIC_URL || ""}/ai-config.json`;

let cachedConfig: AiConfig | null = null;

/**
 * Load the runtime AI configuration from public/ai-config.json.
 * Falls back to the built-in defaults when the file is missing or invalid.
 */
export const loadAiConfig = async (force = false): Promise<AiConfig> => {
  if (cachedConfig && !force) return cachedConfig;
  try {
    const res = await fetch(CONFIG_PATH, { cache: "no-store" });
    if (res.ok) {
      const raw = await res.json();
      const merged: AiConfig = {
        ...DEFAULT_CONFIG,
        ...raw,
        auth: {
          ...DEFAULT_CONFIG.auth,
          ...(raw.auth || {}),
          dsp: { ...DEFAULT_CONFIG.auth.dsp, ...((raw.auth || {}).dsp || {}) },
        },
      };
      merged.models =
        Array.isArray(merged.models) && merged.models.length
          ? merged.models
          : DEFAULT_CONFIG.models;
      cachedConfig = merged;
      return merged;
    }
  } catch {
    // fall through to defaults
  }
  cachedConfig = DEFAULT_CONFIG;
  return DEFAULT_CONFIG;
};

/** User-supplied credential (used when auth.type === "user" or as {{apiKey}} in DSP requests) */
const API_KEY_STORAGE = "feast-ai-api-key";

export const getApiKey = (): string =>
  localStorage.getItem(API_KEY_STORAGE) ||
  process.env.REACT_APP_AI_API_KEY ||
  "";

// ---------------------------------------------------------------------------
// DSP token acquisition
// ---------------------------------------------------------------------------

let dspTokenCache: { token: string; expiresAt: number } | null = null;

/** Read a value from a nested object using a dot-separated path */
const getByPath = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>(
    (acc, key) =>
      acc && typeof acc === "object"
        ? (acc as Record<string, unknown>)[key]
        : undefined,
    obj,
  );

/** Replace {{var}} placeholders in a nested structure */
const renderTemplate = (
  value: unknown,
  vars: Record<string, string>,
): unknown => {
  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? "");
  }
  if (Array.isArray(value)) {
    return value.map((v) => renderTemplate(v, vars));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        renderTemplate(v, vars),
      ]),
    );
  }
  return value;
};

/** Generate a random UUID (v4), used by the {{uuid}} template variable */
const genUuid = (): string =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

/**
 * Acquire a DSP token:
 * 1. POST/GET auth.dsp.tokenUrl (e.g. an "issue_token" endpoint) with
 *    the configured body/headers
 * 2. Extract the token from the response using auth.dsp.tokenPath
 * 3. Cache it until auth.dsp.expiresInPath (seconds) or 10 minutes
 */
const getDspToken = async (config: AiConfig): Promise<string> => {
  const dsp = config.auth.dsp;
  if (!dsp || !dsp.tokenUrl) {
    throw new Error(
      "DSP authentication is enabled but 'auth.dsp.tokenUrl' is not configured.",
    );
  }

  if (dspTokenCache && dspTokenCache.expiresAt > Date.now()) {
    return dspTokenCache.token;
  }

  const method = (dsp.tokenMethod || "POST").toUpperCase();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(dsp.tokenHeaders || {}),
  };

  // Credentials come from ai-config.json (env overrides replace {{username}} /
  // {{password}} at startup); {{apiKey}} falls back to REACT_APP_AI_API_KEY.
  const bodyValue = renderTemplate(dsp.tokenBody || {}, {
    apiKey: getApiKey(),
  });

  let body: BodyInit | undefined;
  if (method !== "GET") {
    if (
      (dsp.tokenContentType || "application/json").includes(
        "x-www-form-urlencoded",
      )
    ) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(
        bodyValue as Record<string, string>,
      ).toString();
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(bodyValue);
    }
  }

  const target = config.proxyAiRequests
    ? `${config.backendBaseUrl}/dsp-token`
    : dsp.tokenUrl;
  const res = await fetch(target, { method, headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `DSP token request failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const json = await res.json().catch(() => ({}));
  const tokenPath = dsp.tokenPath || "issue_token";
  const token = getByPath(json, tokenPath);
  if (typeof token !== "string" || !token) {
    throw new Error(
      `DSP token response has no token at '${tokenPath}'. ` +
        `Received: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }

  const expiresIn = Number(
    getByPath(json, dsp.expiresInPath || "expires_in"),
  );
  dspTokenCache = {
    token,
    expiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? Date.now() + expiresIn * 1000
        : Date.now() + 10 * 60 * 1000,
  };
  return token;
};

/** Build auth headers for the AI request according to the runtime configuration */
const buildAuthHeaders = async (
  config: AiConfig,
  userKey?: string,
): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.auth.type === "none") return headers;

  let key = "";
  if (config.auth.type === "fixed") {
    key = config.auth.apiKey || "";
  } else if (config.auth.type === "user") {
    key = userKey || getApiKey();
  } else if (config.auth.type === "dsp") {
    key = await getDspToken(config);
  }

  if (key) {
    headers[config.auth.headerName || "Authorization"] =
      (config.auth.headerPrefix || "") + key;
  }
  return headers;
};

const SYSTEM_PROMPT = `You are the assistant for FCIS, a feature platform built on Feast, the open-source feature store. You can query real data from the feature platform backend by calling the tools provided to you.

How to pick the right Feast API (tools) for a user question:
1. If the user asks about a specific project, first call list_projects to get real project names, then pass the matching project name to list/filter tools (e.g. list_feature_views with project). Never invent a project name.
2. List vs details: use list_* to enumerate resources; use get_* to inspect a specific resource. When a resource name is unknown, list first, then get details.
3. Search: for keyword queries across resource types, use search_resources.
4. Lineage: use list_lineage_objects (single object) or list_lineage_complete (whole registry).
5. Monitoring/quality: use get_monitoring_features / get_monitoring_feature_views / get_monitoring_timeseries.
6. Materialization: use list_materialization_jobs.
7. Counts/tags/recents: use get_resource_counts / get_popular_tags / get_recently_visited.
8. Multiple steps are allowed: run the tools you need, then summarize from the real results.

Answering rules:
1. Answer ONLY based on the real data returned by the tools. Reference actual names, counts, and projects in your answers. Keep answers concise and clear.
2. If the user's question cannot be answered with the available tools, or is outside the scope of the feature platform, reply honestly with "Sorry, I cannot answer this question" or "I don't have this information". Never guess, speculate, or fabricate answers.
3. When a tool returns an empty list, say so truthfully (e.g. "No matching data was found"). Do not invent resources that do not exist.
4. Answer in the same language the user used.`;

interface ToolSpec {
  /** Path relative to the feature platform backend; supports :name placeholders */
  path: string;
  /**
   * Fallback list path without the `project` filter.
   * Used automatically when the model does not provide a project
   * (the /xxx/all endpoints do not accept a project parameter).
   */
  allPath?: string;
  query?: (args: Record<string, unknown>) => Record<string, unknown>;
}

/** Tool -> read-only backend GET API mapping (from the Feast Registry Server OpenAPI) */
const TOOL_SPECS: Record<string, ToolSpec> = {
  list_projects: { path: "/projects" },
  get_project: { path: "/projects/:name" },

  list_entities: {
    path: "/entities",
    allPath: "/entities/all",
    query: (a) => ({ project: a.project }),
  },
  get_entity: { path: "/entities/:name" },

  list_data_sources: {
    path: "/data_sources",
    allPath: "/data_sources/all",
    query: (a) => ({ project: a.project, tags: a.tags }),
  },
  get_data_source: { path: "/data_sources/:name" },

  list_feature_views: {
    path: "/feature_views",
    allPath: "/feature_views/all",
    query: (a) => ({
      project: a.project,
      entity: a.entity,
      feature: a.feature,
      data_source: a.data_source,
      tags: a.tags,
    }),
  },
  get_feature_view: { path: "/feature_views/:name" },

  list_feature_services: {
    path: "/feature_services",
    allPath: "/feature_services/all",
    query: (a) => ({ project: a.project, tags: a.tags }),
  },
  get_feature_service: { path: "/feature_services/:name" },

  list_features: {
    path: "/features",
    allPath: "/features/all",
    query: (a) => ({ project: a.project, feature_view: a.feature_view }),
  },
  get_feature: { path: "/features/:feature_view/:name" },

  list_labels: {
    path: "/labels",
    allPath: "/labels/all",
    query: (a) => ({ project: a.project, feature_view: a.feature_view }),
  },
  list_label_views: {
    path: "/label_views",
    allPath: "/label_views/all",
    query: (a) => ({ project: a.project, tags: a.tags }),
  },
  get_label_view: { path: "/label_views/:name" },

  list_saved_datasets: {
    path: "/saved_datasets",
    allPath: "/saved_datasets/all",
    query: (a) => ({
      project: a.project,
      namespace: a.namespace,
      collection: a.collection,
    }),
  },
  get_saved_dataset: { path: "/saved_datasets/:name" },
  get_saved_dataset_data: {
    path: "/saved_datasets/data/:name",
    query: (a) => ({ project: a.project, limit: a.limit }),
  },
  list_saved_dataset_jobs: {
    path: "/saved_datasets/jobs",
    query: (a) => ({ project: a.project, status: a.status }),
  },

  list_compute_engines: {
    path: "/compute_engines",
    allPath: "/compute_engines/all",
    query: (a) => ({ project: a.project }),
  },

  list_lineage_objects: {
    path: "/lineage/objects/:object_type/:object_name",
    query: (a) => ({ project: a.project }),
  },
  list_lineage_complete: {
    path: "/lineage/complete",
    query: (a) => ({ project: a.project }),
  },
  get_registry_lineage: { path: "/lineage/registry/all" },

  list_materialization_jobs: {
    path: "/materialization_jobs",
    query: (a) => ({
      project: a.project,
      status: a.status,
      feature_view: a.feature_view,
    }),
  },

  get_monitoring_features: {
    path: "/monitoring/metrics/features",
    query: (a) => ({
      project: a.project,
      feature_view_name: a.feature_view,
      feature_name: a.feature_name,
      granularity: a.granularity,
      start_date: a.start_date,
      end_date: a.end_date,
    }),
  },
  get_monitoring_feature_views: {
    path: "/monitoring/metrics/feature_views",
    query: (a) => ({
      project: a.project,
      feature_view_name: a.feature_view,
      granularity: a.granularity,
      start_date: a.start_date,
      end_date: a.end_date,
    }),
  },
  get_monitoring_timeseries: {
    path: "/monitoring/metrics/timeseries",
    query: (a) => ({
      project: a.project,
      feature_view_name: a.feature_view,
      feature_name: a.feature_name,
      granularity: a.granularity,
      start_date: a.start_date,
      end_date: a.end_date,
    }),
  },

  list_permissions: {
    path: "/permissions",
    query: (a) => ({ project: a.project }),
  },

  search_resources: {
    path: "/search",
    query: (a) => ({ query: a.query, projects: a.projects }),
  },
  get_resource_counts: { path: "/metrics/resource_counts" },
  get_popular_tags: { path: "/metrics/popular_tags" },
  get_recently_visited: {
    path: "/metrics/recently_visited",
    query: (a) => ({ project: a.project }),
  },
};

/** Tool definitions in OpenAI Function Calling format */
const TOOL_DEFS: Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> = [
  {
    type: "function",
    function: {
      name: "list_projects",
      description: "List all projects in the feature platform",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_entities",
      description:
        "List entities, optionally filtered by project (use the project name returned by list_projects)",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_entity",
      description:
        "Get details of a single entity by name (join key, value type, description, etc.)",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Entity name" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_data_sources",
      description: "List data sources, optionally filtered by project",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_data_source",
      description:
        "Get details of a single data source by name (type, timestamp field, configuration, etc.)",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Data source name" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_feature_views",
      description: "List feature views, optionally filtered by project",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_feature_view",
      description:
        "Get details of a single feature view by name (features, entities, TTL, etc.)",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Feature view name" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_feature_services",
      description: "List feature services, optionally filtered by project",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_feature_service",
      description:
        "Get details of a single feature service by name (which feature views it includes)",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Feature service name" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_features",
      description: "List features, optionally filtered by project",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_feature",
      description:
        "Get details of a single feature by feature view and feature name",
      parameters: {
        type: "object",
        properties: {
          feature_view: { type: "string", description: "Feature view name" },
          name: { type: "string", description: "Feature name" },
        },
        required: ["feature_view", "name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_labels",
      description: "List labels, optionally filtered by project",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_label_views",
      description: "List label views, optionally filtered by project",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_label_view",
      description: "Get details of a single label view by name",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Label view name" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_saved_datasets",
      description: "List saved datasets, optionally filtered by project",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_saved_dataset",
      description: "Get details of a single saved dataset by name",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Dataset name" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_compute_engines",
      description: "List compute engines",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_resources",
      description:
        "Search entities, feature views, data sources, and other resources by keyword",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keyword" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_resource_counts",
      description:
        "Get the number of resources of each type in the feature platform",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_popular_tags",
      description: "Get the list of popular tags",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_registry_lineage",
      description:
        "Get lineage data of the registry, optionally filtered by project",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_project",
      description:
        "Get details of a single project by name (description, creation time, etc.)",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_saved_dataset_data",
      description:
        "Get the actual data rows of a saved dataset by name, optionally limited to N rows",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Saved dataset name" },
          project: { type: "string", description: "Optional project name" },
          limit: {
            type: "integer",
            description: "Optional maximum number of rows",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_saved_dataset_jobs",
      description:
        "List saved dataset jobs, optionally filtered by project or status",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
          status: { type: "string", description: "Optional job status" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_lineage_objects",
      description:
        "Get lineage (upstream/downstream) of a single registry object by object type and name",
      parameters: {
        type: "object",
        properties: {
          object_type: {
            type: "string",
            description: "Object type, e.g. feature_view, data_source, feature_service",
          },
          object_name: {
            type: "string",
            description: "Object name",
          },
          project: { type: "string", description: "Optional project name" },
        },
        required: ["object_type", "object_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_lineage_complete",
      description:
        "Get complete lineage of the registry, optionally filtered by project",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_materialization_jobs",
      description:
        "List materialization jobs, optionally filtered by project, status, or feature view",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
          status: {
            type: "string",
            description: "Optional job status filter",
          },
          feature_view: {
            type: "string",
            description: "Optional feature view name",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_monitoring_features",
      description:
        "Get monitoring metrics (freshness/quality) for features, optionally filtered by project, feature view, feature, or date range",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
          feature_view: {
            type: "string",
            description: "Optional feature view name",
          },
          feature_name: {
            type: "string",
            description: "Optional feature name",
          },
          granularity: {
            type: "string",
            description: "Optional time granularity",
          },
          start_date: {
            type: "string",
            description: "Optional start date (YYYY-MM-DD)",
          },
          end_date: {
            type: "string",
            description: "Optional end date (YYYY-MM-DD)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_monitoring_feature_views",
      description:
        "Get monitoring metrics for feature views, optionally filtered by project or feature view",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
          feature_view: {
            type: "string",
            description: "Optional feature view name",
          },
          granularity: {
            type: "string",
            description: "Optional time granularity",
          },
          start_date: {
            type: "string",
            description: "Optional start date (YYYY-MM-DD)",
          },
          end_date: {
            type: "string",
            description: "Optional end date (YYYY-MM-DD)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_monitoring_timeseries",
      description:
        "Get time-series monitoring data, optionally filtered by project, feature view, feature, or date range",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
          feature_view: {
            type: "string",
            description: "Optional feature view name",
          },
          feature_name: {
            type: "string",
            description: "Optional feature name",
          },
          granularity: {
            type: "string",
            description: "Optional time granularity",
          },
          start_date: {
            type: "string",
            description: "Optional start date (YYYY-MM-DD)",
          },
          end_date: {
            type: "string",
            description: "Optional end date (YYYY-MM-DD)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_permissions",
      description: "List permissions, optionally filtered by project",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recently_visited",
      description: "Get recently visited resources in the feature platform",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Optional project name" },
        },
      },
    },
  },
];

/** Replace :placeholder segments in a path with URL-encoded argument values */
const resolvePath = (
  spec: ToolSpec,
  args: Record<string, unknown>,
): string =>
  spec.path.replace(/:([a-zA-Z_]+)/g, (_m, key: string) => {
    const v = args[key];
    return encodeURIComponent(
      v === undefined || v === null ? "" : String(v),
    );
  });

const invokeBackendTool = async (
  backendBaseUrl: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; status: number }> => {
  const spec = TOOL_SPECS[name];
  if (!spec) throw new Error(`Unknown tool: ${name}`);

  const query = spec.query ? spec.query(args) : {};
  // The /xxx/all endpoints do not accept a project parameter:
  // when the model did not specify a project, fall back to the all endpoint.
  const hasProject = Boolean(query.project && String(query.project).trim());
  let path = resolvePath(spec, args);
  if (spec.allPath && !hasProject) {
    path = spec.allPath;
    delete query.project;
  }
  const url = new URL(path, window.location.origin);
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  });

  const res = await fetch(
    `${backendBaseUrl}${url.pathname}${url.search}`,
    { headers: { "Content-Type": "application/json" } },
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Backend API ${res.status}: ${JSON.stringify(data)}`);
  }
  return { data, status: res.status };
};

export interface RunAgentParams {
  /** Runtime configuration (from public/ai-config.json or defaults) */
  config: AiConfig;
  /** User-supplied credential, used when auth.type === "user" or as {{apiKey}} in DSP requests */
  apiKey?: string;
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  onToolCall?: (info: ToolCallInfo) => void;
}

export const runQwenAgent = async ({
  config,
  apiKey,
  model,
  messages,
  onToolCall,
}: RunAgentParams): Promise<AgentResult> => {
  const history: QwenChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages,
  ];
  const toolCalls: ToolCallInfo[] = [];
  const maxRounds = config.maxToolRounds || 5;

  for (let round = 0; round < maxRounds; round++) {
    const requestId = genUuid();
    const extraHeaders = config.extraHeaders
      ? (renderTemplate(config.extraHeaders, { uuid: requestId }) as Record<
          string,
          string
        >)
      : {};
    const extraBody = config.extraBody
      ? (renderTemplate(config.extraBody, { uuid: requestId }) as Record<
          string,
          unknown
        >)
      : {};
    const llmTarget = config.proxyAiRequests
      ? `${config.backendBaseUrl}/llm`
      : config.endpoint;
    const resp = await fetch(llmTarget, {
      method: "POST",
      headers: {
        ...(await buildAuthHeaders(config, apiKey)),
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages: history,
        tools: TOOL_DEFS,
        temperature: 0.2,
        ...extraBody,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(
        `LLM API error ${resp.status}: ${errText.slice(0, 300) || resp.statusText}`,
      );
    }

    const data = await resp.json();
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error("LLM API returned an empty response.");

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      return {
        answer: msg.content?.trim() || "",
        toolCalls,
      };
    }

    // The model requested tool calls: run the backend queries
    history.push(msg);
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      const info: ToolCallInfo = {
        name: call.function.name,
        args,
        ok: false,
      };
      try {
        const { data: result, status } = await invokeBackendTool(
          config.backendBaseUrl,
          call.function.name,
          args,
        );
        info.ok = true;
        info.status = status;
        info.data = result;
        history.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      } catch (e) {
        info.error = e instanceof Error ? e.message : String(e);
        history.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: info.error }),
        });
      }
      toolCalls.push(info);
      onToolCall?.(info);
    }
  }

  return {
    answer:
      "Sorry, I could not reach a clear conclusion after multiple rounds of queries. Please try rephrasing your question.",
    toolCalls,
  };
};
