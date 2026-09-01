const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const https = require("https");
const { feast } = require("./protos");
const { buildRuntimeAiConfig } = require("../ai-config-runtime");

const registryBuf = fs.readFileSync(
  path.resolve(__dirname, "../public/registry.db"),
);
const parsedRegistry = feast.core.Registry.decode(registryBuf);
const projectsList = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../public/projects-list.json")),
);

const toJSON = (obj) => (obj && obj.toJSON ? obj.toJSON() : obj);

const withType = (type) => (fv) => ({
  ...toJSON(fv),
  type,
});

const state = {
  entities: (parsedRegistry.entities || []).map(toJSON),
  featureViews: (parsedRegistry.featureViews || []).map(
    withType("featureView"),
  ),
  onDemandFeatureViews: (parsedRegistry.onDemandFeatureViews || []).map(
    withType("onDemandFeatureView"),
  ),
  streamFeatureViews: (parsedRegistry.streamFeatureViews || []).map(
    withType("streamFeatureView"),
  ),
  featureServices: (parsedRegistry.featureServices || []).map(toJSON),
  dataSources: (parsedRegistry.dataSources || []).map(toJSON),
  savedDatasets: (parsedRegistry.savedDatasets || []).map(toJSON),
  projects: (parsedRegistry.projects || []).map(toJSON),
};

const allFeatureViews = () => [
  ...state.featureViews,
  ...state.onDemandFeatureViews,
  ...state.streamFeatureViews,
];

const objectProject = (obj) => obj?.spec?.project || obj?.project;

const filterByProject = (items, project) => {
  if (!project || project === "all") return items;
  return items.filter((item) => objectProject(item) === project);
};

const allFeatures = (project) =>
  filterByProject(allFeatureViews(), project).flatMap((fv) =>
    (fv?.spec?.features || []).map((feature) => ({
      name: feature.name,
      featureViewName: fv.spec?.name,
      valueType: feature.valueType,
      project: fv.spec?.project,
    })),
  );

const responseList = (res, key, items) => {
  res.json({
    [key]: items,
    pagination: {},
    relationships: {},
  });
};

const findByName = (items, name) =>
  items.find((item) => item?.spec?.name === name || item?.name === name);

const entityPayloadToResource = (payload) => ({
  spec: {
    name: payload.name,
    joinKey: payload.join_key || payload.name,
    valueType: payload.value_type,
    description: payload.description || "",
    tags: payload.tags || {},
    owner: payload.owner || "",
    project: payload.project,
  },
  meta: {},
});

const dataSourcePayloadToResource = (payload) => ({
  name: payload.name,
  type: payload.type,
  timestampField: payload.timestamp_field,
  fieldMapping: payload.field_mapping || {},
  description: payload.description || "",
  tags: payload.tags || {},
  owner: payload.owner || "",
  project: payload.project,
  fileOptions: payload.file_options,
  bigqueryOptions: payload.bigquery_options,
  snowflakeOptions: payload.snowflake_options,
  redshiftOptions: payload.redshift_options,
  kafkaOptions: payload.kafka_options,
  sparkOptions: payload.spark_options,
});

const featureViewPayloadToResource = (payload) => ({
  spec: {
    name: payload.name,
    description: payload.description || "",
    owner: payload.owner || "",
    entities: payload.entities || [],
    features: payload.features || [],
    ttl: payload.ttl,
    online: payload.online,
    tags: payload.tags || {},
    project: payload.project,
    batchSource: payload.batch_source
      ? { name: payload.batch_source }
      : undefined,
  },
  meta: {},
  type: "featureView",
});

// AI 助手后端转发：/ai-backend/* → http://127.0.0.1:6572（Feast REST Registry Server）
// 6572 未开启 CORS，浏览器无法直接跨域访问，需经 dev server 同源转发
const AI_BACKEND_HOST = process.env.FEAST_BACKEND_HOST || "127.0.0.1";
const AI_BACKEND_PORT = Number(process.env.FEAST_BACKEND_PORT || 6572);

// AI 助手 LLM / DSP 同源转发（避免浏览器跨域 CORS）。
// 有效配置 = public/ai-config.json + 环境变量覆盖，可用变量见 ai-config-runtime.js：
//   AI_ENDPOINT / AI_DEFAULT_MODEL / AI_MODELS / AI_LLM_USER
//   AI_DSP_TOKEN_URL / AI_DSP_USERNAME / AI_DSP_PASSWORD
const aiProxyConfig = buildRuntimeAiConfig();
const LLM_ENDPOINT = aiProxyConfig.endpoint || "";
const DSP_TOKEN_URL = aiProxyConfig.auth?.dsp?.tokenUrl || "";

const forwardTo = (target) => (req, res) => {
  const t = new URL(target);
  const mod = t.protocol === "https:" ? https : http;
  const proxyReq = mod.request(
    {
      hostname: t.hostname,
      port: t.port || (t.protocol === "https:" ? 443 : 80),
      path: t.pathname + t.search,
      method: req.method,
      headers: { ...req.headers, host: t.host },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (e) => {
    if (!res.headersSent) {
      res.status(502).json({ detail: `AI proxy error: ${e.message}` });
    } else {
      res.end();
    }
  });
  req.pipe(proxyReq);
};

module.exports = function setupProxy(app) {
  // 动态返回有效 AI 配置（文件 + 环境变量覆盖），前端始终与代理目标一致
  app.get("/ai-config.json", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(aiProxyConfig);
  });

  // 特定 AI 转发需注册在通用 /ai-backend 之前（express 按顺序前缀匹配）
  if (LLM_ENDPOINT) app.use("/ai-backend/llm", forwardTo(LLM_ENDPOINT));
  if (DSP_TOKEN_URL) app.use("/ai-backend/dsp-token", forwardTo(DSP_TOKEN_URL));

  app.use("/ai-backend", (req, res) => {
    const targetPath = req.url || "/";
    const proxyReq = http.request(
      {
        host: AI_BACKEND_HOST,
        port: AI_BACKEND_PORT,
        path: targetPath,
        method: req.method,
        headers: { ...req.headers, host: `${AI_BACKEND_HOST}:${AI_BACKEND_PORT}` },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on("error", () => {
      if (!res.headersSent) {
        res
          .status(502)
          .json({ detail: `Feast backend unreachable at ${AI_BACKEND_HOST}:${AI_BACKEND_PORT}` });
      } else {
        res.end();
      }
    });
    req.pipe(proxyReq);
  });

  app.use("/api/v1", express.json());

  app.get("/projects-list.json", (_req, res) => {
    res.json({
      ...projectsList,
      projects: projectsList.projects.map((project) =>
        project.id === "credit_scoring_aws"
          ? { ...project, registryPath: "/api/v1" }
          : project,
      ),
    });
  });

  app.get("/api/v1/entities/all", (_req, res) =>
    responseList(res, "entities", state.entities),
  );
  app.get("/api/v1/feature_views/all", (_req, res) =>
    responseList(res, "featureViews", allFeatureViews()),
  );
  app.get("/api/v1/feature_services/all", (_req, res) =>
    responseList(res, "featureServices", state.featureServices),
  );
  app.get("/api/v1/data_sources/all", (_req, res) =>
    responseList(res, "dataSources", state.dataSources),
  );
  app.get("/api/v1/saved_datasets/all", (_req, res) =>
    responseList(res, "savedDatasets", state.savedDatasets),
  );
  app.get("/api/v1/features/all", (_req, res) =>
    responseList(res, "features", allFeatures()),
  );
  app.get("/api/v1/label_views/all", (_req, res) =>
    responseList(res, "featureViews", []),
  );

  app.get("/api/v1/entities", (req, res) =>
    responseList(
      res,
      "entities",
      filterByProject(state.entities, req.query.project),
    ),
  );
  app.get("/api/v1/feature_views", (req, res) =>
    responseList(
      res,
      "featureViews",
      filterByProject(allFeatureViews(), req.query.project),
    ),
  );
  app.get("/api/v1/feature_services", (req, res) =>
    responseList(
      res,
      "featureServices",
      filterByProject(state.featureServices, req.query.project),
    ),
  );
  app.get("/api/v1/data_sources", (req, res) =>
    responseList(
      res,
      "dataSources",
      filterByProject(state.dataSources, req.query.project),
    ),
  );
  app.get("/api/v1/saved_datasets", (req, res) =>
    responseList(
      res,
      "savedDatasets",
      filterByProject(state.savedDatasets, req.query.project),
    ),
  );
  app.get("/api/v1/features", (req, res) =>
    responseList(res, "features", allFeatures(req.query.project)),
  );
  app.get("/api/v1/label_views", (_req, res) =>
    responseList(res, "featureViews", []),
  );
  app.get("/api/v1/labels", (_req, res) => responseList(res, "labels", []));
  app.get("/api/v1/projects", (_req, res) =>
    responseList(res, "projects", state.projects),
  );
  app.get("/api/v1/permissions", (_req, res) =>
    responseList(res, "permissions", []),
  );
  app.get("/api/v1/metrics/:type", (_req, res) => res.json({}));

  app.get("/api/v1/entities/:name", (req, res) => {
    const entity = findByName(state.entities, req.params.name);
    if (!entity) return res.status(404).json({ detail: "Not found" });
    return res.json(entity);
  });
  app.get("/api/v1/feature_views/:name", (req, res) => {
    const featureView = findByName(allFeatureViews(), req.params.name);
    if (!featureView) return res.status(404).json({ detail: "Not found" });
    return res.json(featureView);
  });
  app.get("/api/v1/feature_services/:name", (req, res) => {
    const featureService = findByName(state.featureServices, req.params.name);
    if (!featureService) return res.status(404).json({ detail: "Not found" });
    return res.json(featureService);
  });
  app.get("/api/v1/data_sources/:name", (req, res) => {
    const dataSource = findByName(state.dataSources, req.params.name);
    if (!dataSource) return res.status(404).json({ detail: "Not found" });
    return res.json(dataSource);
  });
  app.get("/api/v1/saved_datasets/:name", (req, res) => {
    const savedDataset = findByName(state.savedDatasets, req.params.name);
    if (!savedDataset) return res.status(404).json({ detail: "Not found" });
    return res.json(savedDataset);
  });
  app.get("/api/v1/features/:fvName/:featureName", (req, res) => {
    const featureView = findByName(allFeatureViews(), req.params.fvName);
    const feature = featureView?.spec?.features?.find(
      (f) => f.name === req.params.featureName,
    );
    if (!feature) return res.status(404).json({ detail: "Not found" });
    return res.json({
      featureViewName: req.params.fvName,
      featureName: req.params.featureName,
      feature,
      featureView,
    });
  });

  app.post("/api/v1/entities", (req, res) => {
    const body = req.body || {};
    const existingIndex = state.entities.findIndex(
      (entity) => entity?.spec?.name === body.name,
    );
    const entity = entityPayloadToResource(body);
    if (existingIndex >= 0) {
      state.entities[existingIndex] = entity;
    } else {
      state.entities.push(entity);
    }
    res.json({
      name: body.name,
      project: body.project,
      status: "applied",
    });
  });

  app.post("/api/v1/data_sources", (req, res) => {
    const body = req.body || {};
    const existingIndex = state.dataSources.findIndex(
      (dataSource) => dataSource?.name === body.name,
    );
    const dataSource = dataSourcePayloadToResource(body);
    if (existingIndex >= 0) {
      state.dataSources[existingIndex] = dataSource;
    } else {
      state.dataSources.push(dataSource);
    }
    res.json({
      name: body.name,
      project: body.project,
      status: "applied",
    });
  });

  app.post("/api/v1/feature_views", (req, res) => {
    const body = req.body || {};
    const existingIndex = state.featureViews.findIndex(
      (featureView) => featureView?.spec?.name === body.name,
    );
    const featureView = featureViewPayloadToResource(body);
    if (existingIndex >= 0) {
      state.featureViews[existingIndex] = featureView;
    } else {
      state.featureViews.push(featureView);
    }
    res.json({
      name: body.name,
      project: body.project,
      status: "applied",
    });
  });

  app.delete("/api/v1/entities/:name", (req, res) => {
    state.entities = state.entities.filter(
      (entity) => entity?.spec?.name !== req.params.name,
    );
    res.json({
      name: req.params.name,
      project: req.query.project,
      status: "deleted",
    });
  });

  app.delete("/api/v1/data_sources/:name", (req, res) => {
    state.dataSources = state.dataSources.filter(
      (dataSource) => dataSource?.name !== req.params.name,
    );
    res.json({
      name: req.params.name,
      project: req.query.project,
      status: "deleted",
    });
  });

  app.delete("/api/v1/feature_views/:name", (req, res) => {
    state.featureViews = state.featureViews.filter(
      (featureView) => featureView?.spec?.name !== req.params.name,
    );
    res.json({
      name: req.params.name,
      project: req.query.project,
      status: "deleted",
    });
  });
};
