import React, { useState, useRef, useEffect } from "react";

import {
  EuiGlobalToastList,
  EuiPage,
  EuiPageSidebar,
  EuiPageBody,
  EuiErrorBoundary,
  EuiHorizontalRule,
  EuiSpacer,
  EuiFlexGroup,
  EuiFlexItem,
  EuiAvatar,
  EuiText,
  EuiBadge,
  EuiToolTip,
  EuiPopover,
  EuiButtonEmpty,
  EuiButtonIcon,
  EuiIcon,
  EuiContextMenuPanel,
  EuiContextMenuItem,
} from "@elastic/eui";
import { Outlet } from "react-router-dom";

import RegistryPathContext from "../contexts/RegistryPathContext";
import { useParams } from "react-router-dom";
import { useLoadProjectsList } from "../contexts/ProjectListContext";
import useLoadRegistry from "../queries/useLoadRegistry";

import ProjectSelector from "../components/ProjectSelector";
import Sidebar from "./Sidebar";
import ThemeToggle from "../components/ThemeToggle";
import AIChatPanel from "../components/AIChatPanel";
import RegistrySearch, {
  RegistrySearchRef,
} from "../components/RegistrySearch";
import GlobalSearchShortcut from "../components/GlobalSearchShortcut";
import CommandPalette from "../components/CommandPalette";
import { useAuth } from "../contexts/AuthContext";
import { RegistryRefreshContext } from "../contexts/RegistryRefreshContext";
import useRegistryRefresh from "../hooks/useRegistryRefresh";

const Layout = () => {
  let { projectName } = useParams();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const searchRef = useRef<RegistrySearchRef>(null);
  // AI 悬浮按钮：垂直位置（百分比），支持上下拖动
  const [aiBtnTop, setAiBtnTop] = useState(50);
  const aiBtnRef = useRef<HTMLDivElement>(null);
  const aiDragMovedRef = useRef(false);
  const { user, logout, isAuthEnabled } = useAuth();
  const { refreshing, toasts, handleRefresh, removeToast } =
    useRegistryRefresh();

  const { data: projectsData } = useLoadProjectsList();

  const currentProject = projectsData?.projects.find((project) => {
    return project.id === projectName;
  });

  const registryPath = currentProject?.registryPath || "";

  // For global search, use the first available registry path (typically all projects share the same registry)
  // If projects have different registries, we use the first one as the "global" registry
  const globalRegistryPath =
    projectsData?.projects?.[0]?.registryPath || registryPath;

  // Load filtered data for current project (for sidebar and page-level search)
  const { data } = useLoadRegistry(registryPath, projectName);

  // Load unfiltered data for global search (across all projects)
  const { data: globalData } = useLoadRegistry(globalRegistryPath);

  // Helper function to extract project ID from an item
  const getProjectId = (item: any): string => {
    // Try different possible locations for the project field
    return item?.spec?.project || item?.project || projectName || "unknown";
  };

  // Categories for global search (includes all projects)
  const globalCategories = globalData
    ? [
        {
          name: "Data Sources",
          data: (globalData.objects.dataSources || []).map((item: any) => ({
            ...item,
            projectId: getProjectId(item),
          })),
          getLink: (item: any) => {
            const project = item?.projectId || getProjectId(item);
            return `/p/${project}/data-source/${item.name}`;
          },
        },
        {
          name: "Entities",
          data: (globalData.objects.entities || []).map((item: any) => ({
            ...item,
            projectId: getProjectId(item),
          })),
          getLink: (item: any) => {
            const project = item?.projectId || getProjectId(item);
            return `/p/${project}/entity/${item.name}`;
          },
        },
        {
          name: "Features",
          data: (globalData.allFeatures || []).map((item: any) => ({
            ...item,
            projectId: getProjectId(item),
          })),
          getLink: (item: any) => {
            const featureView = item?.featureView;
            const project = item?.projectId || getProjectId(item);
            return featureView
              ? `/p/${project}/feature-view/${featureView}/feature/${item.name}`
              : "#";
          },
        },
        {
          name: "Feature Views",
          data: (globalData.mergedFVList || []).map((item: any) => ({
            ...item,
            projectId: getProjectId(item),
          })),
          getLink: (item: any) => {
            const project = item?.projectId || getProjectId(item);
            return `/p/${project}/feature-view/${item.name}`;
          },
        },
        {
          name: "Label Views",
          data: (globalData.objects.labelViews || []).map((item: any) => ({
            ...item,
            projectId: getProjectId(item),
          })),
          getLink: (item: any) => {
            const lvName = item?.name || item?.spec?.name;
            const project = item?.projectId || getProjectId(item);
            return `/p/${project}/label-view/${lvName}`;
          },
        },
        {
          name: "Feature Services",
          data: (globalData.objects.featureServices || []).map((item: any) => ({
            ...item,
            projectId: getProjectId(item),
          })),
          getLink: (item: any) => {
            const serviceName = item?.name || item?.spec?.name;
            const project = item?.projectId || getProjectId(item);
            return serviceName
              ? `/p/${project}/feature-service/${serviceName}`
              : "#";
          },
        },
      ]
    : [];

  const handleSearchOpen = () => {
    setIsCommandPaletteOpen(true);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        handleSearchOpen();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  // AI 悬浮按钮：按下后拖动改变垂直位置
  const startAiBtnDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    aiDragMovedRef.current = false;
    const startY = e.clientY;
    const startTop = aiBtnTop;
    const onMove = (ev: PointerEvent) => {
      const rect = aiBtnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > 5) {
        aiDragMovedRef.current = true;
      }
      const centerPx = (startTop / 100) * window.innerHeight + dy;
      const half = rect.height / 2;
      const minCenter = 8 + half;
      const maxCenter = window.innerHeight - 8 - half;
      const clamped = Math.max(minCenter, Math.min(maxCenter, centerPx));
      setAiBtnTop((clamped / window.innerHeight) * 100);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  return (
    <RegistryRefreshContext.Provider value={{ refreshing, handleRefresh }}>
      <RegistryPathContext.Provider value={registryPath}>
        <GlobalSearchShortcut onOpen={handleSearchOpen} />
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          categories={globalCategories}
        />
        {/* 平铺容器：AI 面板打开时主页面收缩，左右并排互不遮挡 */}
        <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
          <EuiPage
            paddingSize="none"
            style={{
              background: "transparent",
              height: "100%",
              overflow: "hidden",
              flexDirection: "column",
              flex: "none",
              width: isAIPanelOpen ? "75%" : "100%",
              transition: "width 0.5s ease",
              minWidth: 0,
            }}
          >
          {/* 顶部统一色 Header（整行颜色一致，固定在上侧） */}
          <div
            className="fcis-header"
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "10px 16px",
              borderBottom: "1px solid #e8e8e8",
              boxShadow: "0px 1px 5px rgba(0, 0, 0, 0.05)",
              position: "relative",
            }}
          >
            {/* LOGO：固定在上侧，相对目录栏居中（目录栏宽 240 / 折叠 64） */}
            <img
              src="/logo-fcis.svg"
              alt="FCIS"
              style={{
                position: "absolute",
                left: isSidebarCollapsed ? 32 : 120,
                top: "50%",
                transform: "translate(-50%, -50%)",
                height: 40,
                width: "auto",
                objectFit: "contain",
              }}
            />

            {/* 左侧占位：保证搜索框居中 */}
            <div style={{ flex: 1 }} />

            {/* 中间：搜索框 */}
            <div style={{ maxWidth: 600, width: "100%" }}>
              {data && (
                <RegistrySearch
                  ref={searchRef}
                  categories={globalCategories}
                />
              )}
            </div>

            {/* 右侧：操作按钮 */}
            <div
              style={{
                flex: 1,
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 12,
                minWidth: 0,
              }}
            >
            {projectName && (
              <EuiToolTip content="Refresh" position="bottom">
                <span
                  tabIndex={0}
                  style={{ display: "inline-flex" }}
                >
                  <EuiButtonEmpty
                    onClick={handleRefresh}
                    isLoading={refreshing}
                    isDisabled={refreshing}
                    size="s"
                    aria-label="Refresh"
                  >
                    <EuiIcon
                      type="refresh"
                      size="l"
                      style={{ width: 30, height: 30 }}
                    />
                    </EuiButtonEmpty>
                    </span>
                    </EuiToolTip>
                    )}
                    <EuiPopover
                    id="helpMenuPopover"
                    button={
                    <EuiButtonEmpty
                    size="s"
                    aria-label="Help"
                    onClick={() => setIsHelpMenuOpen((v) => !v)}
                    >
                    <EuiIcon
                      type="questionInCircle"
                      size="l"
                      style={{ width: 34, height: 34 }}
                    />
                    </EuiButtonEmpty>
                    }
                    isOpen={isHelpMenuOpen}
                    closePopover={() => setIsHelpMenuOpen(false)}
                    anchorPosition="downRight"
                    panelPaddingSize="none"
                    >
                    <EuiContextMenuPanel
                    size="s"
                    items={[
                    <EuiContextMenuItem
                      key="docs"
                      icon="documentation"
                      onClick={() => {
                        setIsHelpMenuOpen(false);
                        window.open(
                          "https://docs.feast.dev/",
                          "_blank",
                          "noopener,noreferrer",
                        );
                      }}
                    >
                      Docs
                    </EuiContextMenuItem>,
                    <EuiContextMenuItem
                      key="support"
                      icon="popout"
                      onClick={() => {
                        setIsHelpMenuOpen(false);
                        window.open(
                          "https://github.com/feast-dev/feast/issues",
                          "_blank",
                          "noopener,noreferrer",
                        );
                      }}
                    >
                      Support
                    </EuiContextMenuItem>,
                    ]}
                    />
                    </EuiPopover>
            {isAuthEnabled && user && (
              <>
                {/* 操作区与用户区的垂直分隔线 */}
                <div
                  style={{
                    width: 1,
                    height: 20,
                    background: "#E0E0E0",
                    margin: "0 4px",
                  }}
                />
                <EuiPopover
                  button={
                  <button
                    onClick={() => setIsUserMenuOpen((v) => !v)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "4px 8px",
                      borderRadius: 6,
                      color: "inherit",
                    }}
                    aria-label="User menu"
                  >
                    <EuiAvatar
                      name={user.username}
                      size="s"
                      color="#DB0011"
                    />
                    <EuiText size="xs">
                      <strong>{user.username}</strong>
                    </EuiText>
                    <EuiIcon type="arrowDown" size="s" />
                  </button>
                }
                isOpen={isUserMenuOpen}
                closePopover={() => setIsUserMenuOpen(false)}
                anchorPosition="downRight"
                panelPaddingSize="m"
              >
                <div style={{ minWidth: 220 }}>
                  <EuiFlexGroup
                    gutterSize="s"
                    alignItems="center"
                    responsive={false}
                  >
                    <EuiFlexItem grow={false}>
                      <EuiAvatar
                        name={user.username}
                        size="m"
                        color="#DB0011"
                      />
                    </EuiFlexItem>
                    <EuiFlexItem>
                      <EuiText size="s">
                        <strong>{user.username}</strong>
                      </EuiText>
                      {user.email && (
                        <EuiText size="xs" color="subdued">
                          {user.email}
                        </EuiText>
                      )}
                    </EuiFlexItem>
                  </EuiFlexGroup>

                  {user.roles.length > 0 && (
                    <>
                      <EuiHorizontalRule margin="s" />
                      <EuiText size="xs" color="subdued">
                        <strong>Roles</strong>
                      </EuiText>
                      <EuiSpacer size="xs" />
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 4,
                        }}
                      >
                        {user.roles
                          .filter(
                            (r) =>
                              ![
                                "default-roles-feast",
                                "offline_access",
                                "uma_authorization",
                              ].includes(r),
                          )
                          .map((role) => (
                            <EuiToolTip content={role} key={role}>
                              <EuiBadge color="hollow">{role}</EuiBadge>
                            </EuiToolTip>
                          ))}
                      </div>
                    </>
                  )}

                  {user.groups.length > 0 && (
                    <>
                      <EuiSpacer size="s" />
                      <EuiText size="xs" color="subdued">
                        <strong>Groups</strong>
                      </EuiText>
                      <EuiSpacer size="xs" />
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 4,
                        }}
                      >
                        {user.groups.map((group) => (
                          <EuiBadge color="default" key={group}>
                            {group}
                          </EuiBadge>
                        ))}
                      </div>
                    </>
                  )}

                  <EuiHorizontalRule margin="s" />
                  <EuiButtonEmpty
                    size="s"
                    iconType="exit"
                    onClick={logout}
                    color="danger"
                    flush="left"
                  >
                    Sign out
                  </EuiButtonEmpty>
                </div>
                </EuiPopover>
              </>
            )}
            </div>
          </div>

          {/* 下方：左侧目录栏 + 内容区 */}
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
            <EuiPageSidebar
              paddingSize={isSidebarCollapsed ? "s" : "l"}
              role={"navigation"}
              aria-label={"Top Level"}
              className="fcis-sidebar"
              style={{
                width: isSidebarCollapsed ? 64 : 240,
                minWidth: isSidebarCollapsed ? 64 : 240,
                maxWidth: isSidebarCollapsed ? 64 : 240,
                height: "100%",
                overflowY: "auto",
                overflowX: "hidden",
                paddingTop: "8px",
                backgroundColor: "#26292F",
                color: "#C9CED6",
                transition:
                  "width 0.2s ease, min-width 0.2s ease, max-width 0.2s ease",
              }}
            >
              {isSidebarCollapsed ? (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <EuiButtonIcon
                    iconType="menu"
                    onClick={() => setIsSidebarCollapsed((v) => !v)}
                    aria-label="Expand sidebar"
                    color="text"
                    size="s"
                  />
                </div>
              ) : (
                <React.Fragment>
                  <EuiSpacer size="s" />
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ width: 160, flexShrink: 0 }}>
                      <ProjectSelector />
                    </div>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        justifyContent: "flex-end",
                      }}
                    >
                      <EuiButtonIcon
                        iconType="menuLeft"
                        onClick={() => setIsSidebarCollapsed((v) => !v)}
                        aria-label="Collapse sidebar"
                        color="text"
                        size="s"
                      />
                    </div>
                  </div>
                </React.Fragment>
              )}
              {registryPath && (
                <React.Fragment>
                  <EuiHorizontalRule margin="s" />
                  <Sidebar
                    collapsed={isSidebarCollapsed}
                    onExpand={() => setIsSidebarCollapsed(false)}
                  />
                  <EuiSpacer size="l" />
                  <EuiHorizontalRule margin="s" />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: isSidebarCollapsed
                        ? "center"
                        : "flex-start",
                      alignItems: "center",
                    }}
                  >
                    <ThemeToggle />
                  </div>
                </React.Fragment>
              )}
            </EuiPageSidebar>

            <EuiPageBody>
              <EuiErrorBoundary>
                <div
                  style={{ height: "100%", overflow: "auto", padding: "16px" }}
                >
                  <Outlet />
                </div>
              </EuiErrorBoundary>
            </EuiPageBody>
          </div>
          </EuiPage>
          <AIChatPanel
            isOpen={isAIPanelOpen}
            onClose={() => setIsAIPanelOpen(false)}
          />
          {/* AI 悬浮按钮：固定在页面右侧垂直居中，可上下拖动，点击开合 AI 面板 */}
          <div
            ref={aiBtnRef}
            onPointerDown={startAiBtnDrag}
            style={{
              position: "fixed",
              right: 16,
              top: `${aiBtnTop}%`,
              transform: "translateY(-50%)",
              zIndex: 3000,
              cursor: "grab",
              userSelect: "none",
              touchAction: "none",
              display: "flex",
            }}
          >
            <EuiButtonEmpty
              onClick={() => {
                if (aiDragMovedRef.current) {
                  aiDragMovedRef.current = false;
                  return;
                }
                setIsAIPanelOpen((v) => !v);
              }}
              className="fcis-ai-float-button"
              size="s"
              title="向 FCIS 智能助手提问"
              style={{
                background: "#FFFFFF",
                width: 53,
                height: 53,
                borderRadius: "50%",
                boxShadow: "0 4px 14px rgba(0, 0, 0, 0.18)",
                padding: 0,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <svg
                className="fcis-ai-bubble"
                width={46}
                height={40}
                viewBox="0 0 30 30"
                aria-hidden="true"
                style={{
                  display: "block",
                  verticalAlign: "middle",
                  pointerEvents: "none",
                }}
              >
                <path
                  d="M6 3H24A4 4 0 0 1 28 7V19A4 4 0 0 1 24 23H11L5 29V23H6A4 4 0 0 1 2 19V7A4 4 0 0 1 6 3Z"
                  fill="#DB0011"
                />
                <text
                  x="15"
                  y="18"
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize="15"
                  fontWeight="800"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  AI
                </text>
              </svg>
            </EuiButtonEmpty>
          </div>
        </div>
        <EuiGlobalToastList
          toasts={toasts}
          dismissToast={removeToast}
          toastLifeTimeMs={3000}
        />
      </RegistryPathContext.Provider>
    </RegistryRefreshContext.Provider>
  );
};

export default Layout;
