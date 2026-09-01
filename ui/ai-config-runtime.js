/**
 * Runtime AI configuration builder.
 *
 * Loads public/ai-config.json and overlays environment variables on top of it,
 * so users can configure the LLM / DSP connection when starting the UI
 * (`node server.js` for production, `npm start` for dev) without editing the JSON.
 *
 * Supported environment variables (all optional):
 *   AI_ENDPOINT         - chat completions URL (overrides config.endpoint;
 *                         legacy alias AI_LLM_ENDPOINT is still honoured)
 *   AI_DEFAULT_MODEL    - default model (overrides config.defaultModel)
 *   AI_MODELS           - comma-separated list of selectable models
 *                         (e.g. "qwen3-LLM,qwen3-Plus")
 *   AI_LLM_USER         - value for extraBody.user (e.g. "UC0008739")
 *   AI_DSP_TOKEN_URL    - DSP token endpoint (overrides auth.dsp.tokenUrl)
 *   AI_DSP_USERNAME     - DSP username (replaces the {{username}} placeholder
 *                         inside auth.dsp.tokenBody)
 *   AI_DSP_PASSWORD     - DSP password (replaces the {{password}} placeholder
 *                         inside auth.dsp.tokenBody)
 *   AI_MAX_TOOL_ROUNDS  - max tool-calling rounds (overrides maxToolRounds;
 *                         default 5)
 *   AI_MAX_TOKENS       - max_tokens for chat completions (overrides
 *                         extraBody.max_tokens; default 150)
 *
 * The returned object is what the server responds with for /ai-config.json,
 * so the browser always sees the same effective configuration as the proxy.
 */
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "public", "ai-config.json");

function loadBaseConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

/** Deep-replace {{key}} placeholders in strings (used for tokenBody credentials). */
function replacePlaceholders(value, vars) {
  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (m, key) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m,
    );
  }
  if (Array.isArray(value)) {
    return value.map((v) => replacePlaceholders(v, vars));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      out[k] = replacePlaceholders(value[k], vars);
    }
    return out;
  }
  return value;
}

/**
 * Build the effective runtime configuration:
 * base file values + environment variable overrides.
 */
function buildRuntimeAiConfig(env = process.env) {
  const cfg = JSON.parse(JSON.stringify(loadBaseConfig()));

  const endpoint = env.AI_ENDPOINT || env.AI_LLM_ENDPOINT;
  if (endpoint) cfg.endpoint = endpoint;

  if (env.AI_DEFAULT_MODEL) cfg.defaultModel = env.AI_DEFAULT_MODEL;

  if (env.AI_MODELS) {
    const models = env.AI_MODELS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (models.length) cfg.models = models;
  }

  if (env.AI_LLM_USER) {
    cfg.extraBody = cfg.extraBody || {};
    cfg.extraBody.user = env.AI_LLM_USER;
  }

  // Numeric overrides. Use explicit undefined/"" checks so "0" stays valid.
  const toNonNegativeInt = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  const maxToolRounds = toNonNegativeInt(env.AI_MAX_TOOL_ROUNDS);
  if (maxToolRounds !== null) cfg.maxToolRounds = maxToolRounds;
  const maxTokens = toNonNegativeInt(env.AI_MAX_TOKENS);
  if (maxTokens !== null) {
    cfg.extraBody = cfg.extraBody || {};
    cfg.extraBody.max_tokens = maxTokens;
  }

  if (env.AI_DSP_TOKEN_URL) {
    cfg.auth = cfg.auth || {};
    cfg.auth.dsp = cfg.auth.dsp || {};
    cfg.auth.dsp.tokenUrl = env.AI_DSP_TOKEN_URL;
  }

  // DSP credentials: replace {{username}} / {{password}} placeholders with the
  // env-provided values so the browser no longer asks the user to type them.
  const credVars = {};
  if (env.AI_DSP_USERNAME) credVars.username = env.AI_DSP_USERNAME;
  if (env.AI_DSP_PASSWORD) credVars.password = env.AI_DSP_PASSWORD;
  if (Object.keys(credVars).length && cfg.auth?.dsp?.tokenBody) {
    cfg.auth.dsp.tokenBody = replacePlaceholders(cfg.auth.dsp.tokenBody, credVars);
  }

  return cfg;
}

/**
 * Environment variable reference (single source of truth).
 * Printed in the server startup log so users of the built bundle know which
 * environment variables they can define when starting the UI.
 */
const ENV_VAR_DOCS = [
  {
    name: "PORT",
    desc: "HTTP listen port",
    def: "3000",
  },
  {
    name: "BUILD_DIR",
    desc: "Directory of the static build bundle",
    def: "./build",
  },
  {
    name: "FEAST_BACKEND_HOST",
    desc: "Feast registry server host",
    def: "127.0.0.1",
  },
  {
    name: "FEAST_BACKEND_PORT",
    desc: "Feast registry server port",
    def: "6572",
  },
  {
    name: "AI_ENDPOINT",
    desc: "LLM chat completions URL (alias: AI_LLM_ENDPOINT)",
    def: "value from public/ai-config.json",
  },
  {
    name: "AI_DEFAULT_MODEL",
    desc: "Default model name",
    def: "value from public/ai-config.json",
  },
  {
    name: "AI_MODELS",
    desc: "Comma-separated selectable models, e.g. qwen3-LLM,qwen3-Plus",
    def: "value from public/ai-config.json",
  },
  {
    name: "AI_LLM_USER",
    desc: "Value for extraBody.user, e.g. UC0008739",
    def: "value from public/ai-config.json",
  },
  {
    name: "AI_DSP_TOKEN_URL",
    desc: "DSP token endpoint URL",
    def: "value from public/ai-config.json",
  },
  {
    name: "AI_DSP_USERNAME",
    desc: "DSP username (replaces {{username}} in the token body)",
    def: "unset -> placeholder kept for the UI panel",
  },
  {
    name: "AI_DSP_PASSWORD",
    desc: "DSP password (replaces {{password}} in the token body)",
    def: "unset -> placeholder kept for the UI panel",
  },
  {
    name: "AI_MAX_TOOL_ROUNDS",
    desc: "Max tool-calling rounds",
    def: "5",
  },
  {
    name: "AI_MAX_TOKENS",
    desc: "max_tokens for chat completions",
    def: "150",
  },
];

module.exports = { buildRuntimeAiConfig, ENV_VAR_DOCS };
