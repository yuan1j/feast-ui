/**
 * Dev-server proxy (webpack-dev-server / CRA).
 *
 * Every API call now goes to the FastAPI backend (default http://127.0.0.1:8001),
 * which in turn talks to the Feast Registry Server and the Online Serving API.
 * The browser never calls the registry / online / LLM / DSP services directly,
 * so there are no CORS problems.
 *
 *   /api/v1/*    -> http://127.0.0.1:8001/api/v1/*    (registry via backend)
 *   /backend/*   -> http://127.0.0.1:8001/backend/*   (registry/online tools + AI)
 *
 * Start the backend first:
 *   cd backend && python run.py
 * then:
 *   yarn start
 */
const fs = require("fs");
const http = require("http");

const BACKEND_HOST = process.env.BACKEND_HOST || "127.0.0.1";
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 8001);

// Express strips the mount prefix (e.g. "/api/v1") from req.url before the
// middleware runs, so we must pass the prefix back when forwarding upstream.
const proxyTo = (prefix, host, port) => (req, res) => {
  const proxyReq = http.request(
    {
      host,
      port,
      path: prefix + req.url,
      method: req.method,
      headers: { ...req.headers, host: `${host}:${port}` },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (e) => {
    if (!res.headersSent) {
      res
        .status(502)
        .json({ detail: `FastAPI backend unreachable at ${host}:${port} (${e.message})` });
    } else {
      res.end();
    }
  });
  req.pipe(proxyReq);
};

module.exports = function setupProxy(app) {
  // Registry REST API (standard Feast UI pages) -> FastAPI -> Registry Server
  app.use("/api/v1", proxyTo("/api/v1", BACKEND_HOST, BACKEND_PORT));

  // Backend tools: registry tools, online tools and the AI SSE chat endpoint
  app.use("/backend", proxyTo("/backend", BACKEND_HOST, BACKEND_PORT));

  // Point every project at the real registry served through the backend.
  app.get("/projects-list.json", (_req, res) => {
    let projectsList = { projects: [] };
    try {
      projectsList = JSON.parse(
        fs.readFileSync(require("path").resolve(__dirname, "../public/projects-list.json"), "utf8"),
      );
    } catch {
      // fall through with the empty list
    }
    res.json({
      ...projectsList,
      projects: projectsList.projects.map((project) => ({
        ...project,
        registryPath: "/api/v1",
      })),
    });
  });
};
