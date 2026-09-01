import React from "react";

const DEFAULT_URL = "https://www.baidu.com";

// 从运行时配置读取嵌入 URL（见 public/config.js，构建后改 build/config.js 即可生效）
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
