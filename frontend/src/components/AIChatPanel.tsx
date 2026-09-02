import React, { useEffect, useRef, useState } from "react";
import {
  EuiButton,
  EuiButtonIcon,
  EuiSelect,
  EuiSpacer,
  EuiText,
  EuiTextArea,
  EuiTitle,
  EuiToolTip,
} from "@elastic/eui";
import { useTheme } from "../contexts/ThemeContext";
import {
  loadAiConfig,
  runQwenAgent,
  type AiConfig,
  type ToolCallInfo,
} from "../utils/qwenAgent";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

// Human-readable labels shown while a tool is being executed
const TOOL_LABELS: Record<string, string> = {
  list_projects: "Listing projects",
  get_project: "Fetching project details",
  list_entities: "Listing entities",
  get_entity: "Fetching entity details",
  list_data_sources: "Listing data sources",
  get_data_source: "Fetching data source details",
  list_feature_views: "Listing feature views",
  get_feature_view: "Fetching feature view details",
  list_feature_services: "Listing feature services",
  get_feature_service: "Fetching feature service details",
  list_features: "Listing features",
  get_feature: "Fetching feature details",
  list_labels: "Listing labels",
  list_label_views: "Listing label views",
  get_label_view: "Fetching label view details",
  list_saved_datasets: "Listing saved datasets",
  get_saved_dataset: "Fetching dataset details",
  get_saved_dataset_data: "Fetching dataset rows",
  list_saved_dataset_jobs: "Listing dataset jobs",
  list_compute_engines: "Listing compute engines",
  list_lineage_objects: "Fetching object lineage",
  list_lineage_complete: "Fetching complete lineage",
  get_registry_lineage: "Fetching registry lineage",
  list_materialization_jobs: "Listing materialization jobs",
  get_monitoring_features: "Fetching feature monitoring metrics",
  get_monitoring_feature_views: "Fetching feature view monitoring metrics",
  get_monitoring_timeseries: "Fetching monitoring time series",
  list_permissions: "Listing permissions",
  search_resources: "Searching resources",
  get_resource_counts: "Fetching resource counts",
  get_popular_tags: "Fetching popular tags",
  get_recently_visited: "Fetching recently visited resources",
};

const FALLBACK_MODELS = ["qwen-plus"];

const AIChatPanel: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { colorMode } = useTheme();
  const isDark = colorMode === "dark";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [model, setModel] = useState<string>("");
  const [models, setModels] = useState<string[]>(FALLBACK_MODELS);
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [configReady, setConfigReady] = useState(false);
  const [currentTool, setCurrentTool] = useState<string>("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const idRef = useRef(0);

  // Load the AI configuration (served by the FastAPI backend at /backend/ai/config)
  useEffect(() => {
    let cancelled = false;
    loadAiConfig().then((cfg) => {
      if (cancelled) return;
      setConfig(cfg);
      setModels(cfg.models.length ? cfg.models : FALLBACK_MODELS);
      setModel((prev) => prev || cfg.defaultModel);
      setConfigReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus the input when the panel opens
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const nextId = () => ++idRef.current;

  useEffect(() => {
    setMessages([
      {
        id: nextId(),
        role: "assistant",
        content:
          "Hello! I'm the FCIS assistant, powered by an LLM. I can look up real data in the feature platform — ask me about features, data sources, entities, feature services, projects, and more. If I can't answer, I'll tell you honestly.",
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to the bottom on new messages
  useEffect(() => {
    const el = bodyRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, isSending, currentTool]);

  const doSend = async (content: string) => {
    if (!content || isSending) return;

    if (!config) {
      try {
        const cfg = await loadAiConfig(true);
        setConfig(cfg);
        setModels(cfg.models.length ? cfg.models : FALLBACK_MODELS);
        setModel(cfg.defaultModel);
        if (!cfg.models.length) setModels(FALLBACK_MODELS);
      } catch {
        // keep default config
      }
    }
    const cfg = config || (await loadAiConfig());

    setInput("");
    setMessages((prev) => [...prev, { id: nextId(), role: "user", content }]);
    setIsSending(true);
    setCurrentTool("");

    // Keep the conversation history for context
    const qwenMessages = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content },
    ];

    // The streaming assistant message: deltas are appended to it in real time
    const streamingId = nextId();
    const appendDelta = (delta: string) => {
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findIndex((m) => m.id === streamingId);
        if (idx >= 0) {
          next[idx] = { ...next[idx], content: next[idx].content + delta };
        } else {
          next.push({ id: streamingId, role: "assistant", content: delta });
        }
        return next;
      });
    };

    try {
      const { answer } = await runQwenAgent({
        model: model || cfg.defaultModel,
        messages: qwenMessages,
        onDelta: appendDelta,
        onToolCall: (info: ToolCallInfo) => {
          const label = TOOL_LABELS[info.name] || info.name;
          setCurrentTool(
            info.ok ? label : `${label} (failed: ${info.error || "error"})`,
          );
        },
      });
      // Ensure a final assistant message exists even when the backend sent no
      // text delta (e.g. an empty final answer).
      setMessages((prev) => {
        if (prev.some((m) => m.id === streamingId)) return prev;
        return [
          ...prev,
          {
            id: streamingId,
            role: "assistant",
            content: answer || "Sorry, I cannot answer this question.",
          },
        ];
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          content: errMsg.includes("401")
            ? "Authentication failed. Please check the AI credentials (AI_DSP_USERNAME / AI_DSP_PASSWORD) configured in backend/.env."
            : `Request failed: ${errMsg}`,
        },
      ]);
    } finally {
      setIsSending(false);
      setCurrentTool("");
    }
  };

  const handleSend = async () => {
    const content = input.trim();
    if (!content || isSending) return;

    if (!config) {
      try {
        const cfg = await loadAiConfig(true);
        setConfig(cfg);
        setModels(cfg.models.length ? cfg.models : FALLBACK_MODELS);
        setModel(cfg.defaultModel);
        if (!cfg.models.length) setModels(FALLBACK_MODELS);
      } catch {
        // keep default config
      }
    }
    const cfg = config || (await loadAiConfig());

    await doSend(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const bubbleStyle = (role: ChatMessage["role"]): React.CSSProperties => {
    if (role === "user") {
      return {
        alignSelf: "flex-end",
        background: "#DB0011",
        color: "#FFFFFF",
        borderBottomRightRadius: 4,
      };
    }
    return {
      alignSelf: "flex-start",
      background: isDark ? "#2C3242" : "#F0F1F4",
      color: isDark ? "#E5E7EB" : "#1A1A1A",
      borderBottomLeftRadius: 4,
    };
  };

  const borderColor = isDark ? "#2C3242" : "#E6E6E6";

  // Flattened panel: occupies the right 1/4 of the page with a smooth 0.5s transition
  return (
    <div
      style={{
        flex: "0 0 auto",
        width: isOpen ? "25%" : "0",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: isDark ? "#1E2230" : "#FFFFFF",
        borderLeft: `1px solid ${borderColor}`,
        boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.18)",
        transition: "width 0.5s ease",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {/* Header */}
        <div
          style={{
            flexShrink: 0,
            padding: "16px 24px",
            borderBottom: `1px solid ${borderColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <EuiTitle size="m">
              <h2 id="ai-chat-title" style={{ margin: 0 }}>
                Ask FCIS
              </h2>
            </EuiTitle>
            <EuiText size="xs" color="subdued">
              Assistant · LLM
            </EuiText>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <EuiToolTip content="AI settings (model)">
              <EuiButtonIcon
                iconType="gear"
                onClick={() => setSettingsOpen((v) => !v)}
                aria-label="AI settings"
                color="text"
                style={{
                  background: settingsOpen
                    ? isDark
                      ? "#2C3242"
                      : "#E6E6E6"
                    : "transparent",
                  borderRadius: 8,
                }}
              />
            </EuiToolTip>
            <EuiButtonIcon
              iconType="cross"
              onClick={onClose}
              aria-label="Close AI chat"
              color="danger"
            />
          </div>
        </div>

        {/* Settings: only the model selector */}
        {settingsOpen && (
          <div
            style={{
              flexShrink: 0,
              padding: "12px 16px",
              borderBottom: `1px solid ${borderColor}`,
              background: isDark ? "#171B2E" : "#F7F8FA",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <EuiText size="s" style={{ whiteSpace: "nowrap" }}>
              Model:
            </EuiText>
            <EuiSelect
              aria-label="LLM model"
              value={model || config?.defaultModel || ""}
              onChange={(e) => setModel(e.target.value)}
              options={models.map((m) => ({ value: m, text: m }))}
              compressed
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
        )}

        {/* Messages */}
        <div
          ref={bodyRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 16,
            background: isDark ? "#171B2E" : "#F7F8FA",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              minHeight: "100%",
            }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: "flex",
                  justifyContent:
                    msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    ...bubbleStyle(msg.role),
                    maxWidth: "80%",
                    padding: "10px 14px",
                    borderRadius: 12,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 14,
                    lineHeight: 1.6,
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isSending && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div
                  style={{
                    ...bubbleStyle("assistant"),
                    padding: "10px 14px",
                    borderRadius: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      className="euiLoadingSpinner euiLoadingSpinner--small"
                      style={{
                        borderColor: isDark ? "#3A4254" : "#D3D6DE",
                        borderTopColor: "#DB0011",
                      }}
                    />
                    <span style={{ fontSize: 13 }}>Thinking...</span>
                  </div>
                  {currentTool && (
                    <span style={{ fontSize: 12, opacity: 0.75 }}>
                      → {currentTool}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input */}
        <div
          style={{
            flexShrink: 0,
            padding: "12px 16px",
            borderTop: `1px solid ${borderColor}`,
            background: isDark ? "#1E2230" : "#FFFFFF",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <EuiTextArea
              className="fcis-ai-input"
              inputRef={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your question. Enter to send, Shift+Enter for a new line"
              fullWidth
              rows={1}
              compressed
            />
            <EuiButton
              size="m"
              fill
              color="primary"
              onClick={handleSend}
              isLoading={isSending}
              isDisabled={!input.trim() || isSending || !configReady}
            >
              Send
            </EuiButton>
          </div>
          <EuiSpacer size="s" />
          <EuiText size="xs" color="subdued">
            Answers are based on real data from the feature platform APIs.
          </EuiText>
        </div>
      </div>
    </div>
  );
};

export default AIChatPanel;
