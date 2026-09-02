import React from "react";

const DEFAULT_URL = "https://www.baidu.com";

// Read the embedded URL from the runtime config (see public/config.js; edit build/config.js after the build)
const getModelMonitoringUrl = (): string => {
  const config = (window as any).FEAST_UI_CONFIG;
  return config?.modelMonitoringUrl || DEFAULT_URL;
};

const ModelMonitoringPage = () => {
  return (
    <iframe
      src={getModelMonitoringUrl()}
      title="Model Monitoring"
      style={{
        width: "100%",
        height: "calc(100vh - 60px)",
        border: "none",
      }}
    />
  );
};

export default ModelMonitoringPage;
