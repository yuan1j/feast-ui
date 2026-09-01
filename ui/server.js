/**
 * Production server for the Feast UI + AI assistant.
 *
 * One process does three things:
 *   1. Serves the static `build/` directory (SPA fallback to index.html).
 *   2. Proxies /ai-backend/dsp-token -> DSP token endpoint (from public/ai-config.json).
 *   3. Proxies /ai-backend/llm       -> LLM chat completions endpoint (from public/ai-config.json).
 *   4. Proxies all other /ai-backend/* -> Feast Registry Server (default 127.0.0.1:6572).
 *
 * The proxy is REQUIRED even on an intranet: browsers still enforce CORS when
 * they call the DSP / LLM gateways or the registry directly, and none of those
 * endpoints send CORS headers.
 *
 * Usage:
 *   node server.js [port]
 *
 * Environment variables (all optional, overridden on top of public/ai-config.json):
 *   PORT                - listen port (default 3000)
 *   BUILD_DIR           - static build directory (default ./build)
 *   AI_ENDPOINT         - chat completions URL (alias: AI_LLM_ENDPOINT)
 *   AI_DEFAULT_MODEL    - default model name
 *   AI_MODELS           - comma-separated selectable models (e.g. "qwen3-LLM,qwen3-Plus")
 *   AI_LLM_USER         - extraBody.user value (e.g. "UC0008739")
 *   AI_DSP_TOKEN_URL    - DSP token URL
 *   AI_DSP_USERNAME     - DSP username (replaces {{username}} in the token body)
 *   AI_DSP_PASSWORD     - DSP password (replaces {{password}} in the token body)
 *   AI_MAX_TOOL_ROUNDS  - max tool-calling rounds (default 5)
 *   AI_MAX_TOKENS       - max_tokens for chat completions (default 150)
 *   FEAST_BACKEND_HOST  - feast registry host (default 127.0.0.1)
 *   FEAST_BACKEND_PORT  - feast registry port (default 6572)
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const {
  buildRuntimeAiConfig,
  ENV_VAR_DOCS,
} = require("./ai-config-runtime");

const PORT = Number(process.env.PORT || process.argv[2] || 3000);
const BUILD_DIR = path.resolve(
  process.env.BUILD_DIR || path.join(__dirname, "build"),
);
const FEAST_HOST = process.env.FEAST_BACKEND_HOST || "127.0.0.1";
const FEAST_PORT = Number(process.env.FEAST_BACKEND_PORT || 6572);

// Effective AI config = public/ai-config.json + environment variable overrides.
// The same object is served for /ai-config.json so the browser and the proxy
// always agree on endpoint / models / credentials.
const aiConfig = buildRuntimeAiConfig();
const LLM_ENDPOINT = aiConfig.endpoint || "";
const DSP_TOKEN_URL = aiConfig.auth?.dsp?.tokenUrl || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

/** Forward a request to an absolute http(s) target. */
function forward(target, req, res) {
  let u;
  try {
    u = new URL(target);
  } catch {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ detail: `Invalid proxy target: ${target}` }));
    return;
  }
  const mod = u.protocol === "https:" ? https : http;
  const options = {
    hostname: u.hostname,
    port: u.port || (u.protocol === "https:" ? 443 : 80),
    path: u.pathname + u.search,
    method: req.method,
    headers: { ...req.headers, host: u.host },
  };
  const preq = mod.request(options, (pres) => {
    res.writeHead(pres.statusCode, pres.headers);
    pres.pipe(res);
  });
  preq.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ detail: `Proxy error: ${err.message}` }));
    } else {
      res.end();
    }
  });
  req.pipe(preq);
}

function sendFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.resolve(BUILD_DIR, rel);
  if (!filePath.startsWith(BUILD_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) return sendFile(filePath, res);
    // SPA fallback: all unmatched routes serve index.html
    const index = path.join(BUILD_DIR, "index.html");
    fs.stat(index, (e2) => {
      if (!e2) return sendFile(index, res);
      res.writeHead(404);
      res.end("Not found");
    });
  });
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";

  if (url.startsWith("/ai-backend/dsp-token") && DSP_TOKEN_URL) {
    return forward(DSP_TOKEN_URL, req, res);
  }
  if (url.startsWith("/ai-backend/llm") && LLM_ENDPOINT) {
    return forward(LLM_ENDPOINT, req, res);
  }
  if (url.startsWith("/ai-backend")) {
    // Strip the /ai-backend prefix, forward the rest to the Feast registry.
    const rest = url.replace(/^\/ai-backend/, "") || "/";
    return forward(`http://${FEAST_HOST}:${FEAST_PORT}${rest}`, req, res);
  }
  if (url.startsWith("/ai-config.json")) {
    // Serve the effective AI config (file + env overrides) with no-store,
    // so the browser picks up startup-time environment variables.
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(aiConfig));
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    return serveStatic(req, res);
  }
  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Feast UI + AI proxy listening on http://0.0.0.0:${PORT}`);
  console.log(`  Static dir    : ${BUILD_DIR}`);
  console.log(`  Feast API     : http://${FEAST_HOST}:${FEAST_PORT}`);
  console.log(`  LLM endpoint  : ${LLM_ENDPOINT || "(NOT CONFIGURED)"}`);
  console.log(`  Default model : ${aiConfig.defaultModel || "(none)"}`);
  console.log(`  Models        : ${(aiConfig.models || []).join(", ") || "(none)"}`);
  console.log(`  LLM user      : ${aiConfig.extraBody?.user ?? "(not set)"}`);
  console.log(`  maxToolRounds : ${aiConfig.maxToolRounds ?? "(not set)"}`);
  console.log(`  max_tokens    : ${aiConfig.extraBody?.max_tokens ?? "(not set)"}`);
  console.log(`  DSP token URL : ${DSP_TOKEN_URL || "(NOT CONFIGURED)"}`);
  const dspBody = JSON.stringify(aiConfig.auth?.dsp?.tokenBody || "");
  const unresolved = (dspBody.match(/\{\{(\w+)\}\}/g) || []).join(", ");
  console.log(
    `  DSP creds     : ${
      unresolved
        ? `unresolved placeholders: ${unresolved}`
        : "configured (via env or ai-config.json)"
    }`,
  );

  const warnings = [];
  if (!LLM_ENDPOINT) {
    warnings.push(
      "LLM endpoint is not configured: set AI_ENDPOINT (or AI_LLM_ENDPOINT) or edit public/ai-config.json - the AI assistant will be unavailable.",
    );
  }
  if (!DSP_TOKEN_URL) {
    warnings.push(
      "DSP token URL is not configured: set AI_DSP_TOKEN_URL or edit public/ai-config.json.",
    );
  }
  if (unresolved) {
    warnings.push(
      `DSP placeholder(s) ${unresolved} are not filled: pass AI_DSP_USERNAME / AI_DSP_PASSWORD at startup, or fill them in the UI settings panel.`,
    );
  }
  if (warnings.length) {
    console.log("\n[WARN] Some AI parameters need configuration:");
    warnings.forEach((w) => console.log(`  ! ${w}`));
  }

  // Environment variable reference, visible to whoever starts the server.
  console.log(
    "\nEnvironment variables (all optional; override public/ai-config.json):",
  );
  ENV_VAR_DOCS.forEach((d) =>
    console.log(
      `  ${String(d.name).padEnd(20)} ${d.desc}  (default: ${d.def})`,
    ),
  );
});
