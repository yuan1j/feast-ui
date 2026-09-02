/**
 * Production server for the Feast UI.
 *
 * Two responsibilities:
 *   1. Serves the static `build/` directory (SPA fallback to index.html).
 *   2. Forwards /api/v1/* and /backend/* to the FastAPI backend (default
 *      http://127.0.0.1:8001), which talks to the Feast Registry Server, the
 *      Online Serving API, and runs the LLM assistant (DSP token + streaming).
 *
 * The FastAPI backend is REQUIRED: the registry / online / LLM / DSP services
 * do not send CORS headers, so the browser can never call them directly.
 *
 * Usage:
 *   node server.js [port]
 *
 * Environment variables (all optional):
 *   PORT          - listen port (default 3000)
 *   BUILD_DIR     - static build directory (default ./build)
 *   BACKEND_HOST  - FastAPI backend host (default 127.0.0.1)
 *   BACKEND_PORT  - FastAPI backend port (default 8001)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || process.argv[2] || 3000);
const BUILD_DIR = path.resolve(
  process.env.BUILD_DIR || path.join(__dirname, "build"),
);
const BACKEND_HOST = process.env.BACKEND_HOST || "127.0.0.1";
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 8001);

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

function forward(req, res) {
  const proxyReq = http.request(
    {
      host: BACKEND_HOST,
      port: BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${BACKEND_HOST}:${BACKEND_PORT}` },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          detail: `FastAPI backend unreachable at ${BACKEND_HOST}:${BACKEND_PORT}: ${err.message}`,
        }),
      );
    } else {
      res.end();
    }
  });
  req.pipe(proxyReq);
}

function sendFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
  });
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

/** Rewrite every project's registryPath to the backend-served /api/v1. */
function serveProjectsList(req, res) {
  const filePath = path.join(BUILD_DIR, "projects-list.json");
  fs.readFile(filePath, "utf8", (err, raw) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    try {
      const data = JSON.parse(raw);
      data.projects = (data.projects || []).map((p) => ({
        ...p,
        registryPath: "/api/v1",
      }));
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500);
      res.end("Invalid projects-list.json");
    }
  });
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";

  if (url.startsWith("/api/v1") || url.startsWith("/backend")) {
    return forward(req, res);
  }
  if (url.startsWith("/projects-list.json")) {
    return serveProjectsList(req, res);
  }
  if (req.method === "GET" || req.method === "HEAD") {
    return serveStatic(req, res);
  }
  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Feast UI listening on http://0.0.0.0:${PORT}`);
  console.log(`  Static dir   : ${BUILD_DIR}`);
  console.log(`  FastAPI      : http://${BACKEND_HOST}:${BACKEND_PORT}`);
  console.log(
    `  Start the backend first:  cd backend && python run.py`,
  );
});
