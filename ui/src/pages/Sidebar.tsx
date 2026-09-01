import React, { useEffect, useState } from "react";

import {
  EuiIcon,
  EuiSideNav,
  EuiToolTip,
  htmlIdGenerator,
} from "@elastic/eui";
import { Link, useLocation, useParams } from "react-router-dom";
import { useMatchSubpath } from "../hooks/useMatchSubpath";
import useResourceQuery, {
  entityListPath,
  featureViewListPath,
  featureServiceListPath,
  dataSourceListPath,
  savedDatasetListPath,
  featuresListPath,
  labelViewListPath,
  restFeatureViewsToMergedList,
  restLabelViewsFromResponse,
} from "../queries/useResourceQuery";

import { DataSourceIcon } from "../graphics/DataSourceIcon";
import { EntityIcon } from "../graphics/EntityIcon";
import { FeatureViewIcon } from "../graphics/FeatureViewIcon";
import { FeatureServiceIcon } from "../graphics/FeatureServiceIcon";
import { DatasetIcon } from "../graphics/DatasetIcon";
import { FeatureIcon } from "../graphics/FeatureIcon";
import { HomeIcon } from "../graphics/HomeIcon";
import { PermissionsIcon } from "../graphics/PermissionsIcon";
import { LabelViewIcon } from "../graphics/LabelViewIcon";
import { ComputeEngineIcon } from "../graphics/ComputeEngineIcon";
import type { genericFVType } from "../parsers/mergedFVTypes";

interface SidebarProps {
  collapsed?: boolean;
  onExpand?: () => void;
}

const SideNav = ({ collapsed, onExpand }: SidebarProps) => {
  const { projectName } = useParams();

  const { isSuccess: dsSuccess, data: dataSources } = useResourceQuery<any[]>({
    resourceType: "sidebar-ds",
    project: projectName,
    restPath: dataSourceListPath(projectName),
    restSelect: (d) => d.dataSources,
  });

  const { isSuccess: entSuccess, data: entities } = useResourceQuery<any[]>({
    resourceType: "sidebar-entities",
    project: projectName,
    restPath: entityListPath(projectName),
    restSelect: (d) => d.entities,
  });

  const { isSuccess: fvSuccess, data: featureViews } = useResourceQuery<
    genericFVType[]
  >({
    resourceType: "sidebar-fvs",
    project: projectName,
    restPath: featureViewListPath(projectName),
    restSelect: restFeatureViewsToMergedList,
  });

  const { isSuccess: featSuccess, data: features } = useResourceQuery<any[]>({
    resourceType: "sidebar-features",
    project: projectName,
    restPath: featuresListPath(projectName),
    restSelect: (d) => d.features,
  });

  const { isSuccess: fsSuccess, data: featureServices } = useResourceQuery<
    any[]
  >({
    resourceType: "sidebar-fs",
    project: projectName,
    restPath: featureServiceListPath(projectName),
    restSelect: (d) => d.featureServices,
  });

  const { isSuccess: sdSuccess, data: savedDatasets } = useResourceQuery<any[]>(
    {
      resourceType: "sidebar-sd",
      project: projectName,
      restPath: savedDatasetListPath(projectName),
      restSelect: (d) => d.savedDatasets,
    },
  );

  const { isSuccess: lvSuccess, data: labelViews } = useResourceQuery<any[]>({
    resourceType: "sidebar-lvs",
    project: projectName,
    restPath: labelViewListPath(projectName),
    restSelect: restLabelViewsFromResponse,
  });

  const [isSideNavOpenOnMobile, setisSideNavOpenOnMobile] = useState(false);

  // Feature Management 二级目录折叠状态（默认收起，点击一级目录展开）
  const location = useLocation();
  const featureManagementSubPaths = [
    "data-source",
    "entity",
    "features",
    "feature-view",
    "feature-service",
    "label-view",
    "data-set",
    "permissions",
    "compute-engine",
  ];
  const isInFeatureManagement = featureManagementSubPaths.some((suffix) =>
    location.pathname.includes(`/${suffix}`),
  );
  const [featureManagementOpen, setFeatureManagementOpen] = useState(
    isInFeatureManagement,
  );

  useEffect(() => {
    if (isInFeatureManagement) {
      setFeatureManagementOpen(true);
    }
  }, [isInFeatureManagement]);

  const toggleOpenOnMobile = () => {
    setisSideNavOpenOnMobile(!isSideNavOpenOnMobile);
  };

  const dataSourcesLabel = `Data Sources ${dsSuccess && dataSources ? `(${dataSources.length})` : ""}`;
  const entitiesLabel = `Entities ${entSuccess && entities ? `(${entities.length})` : ""}`;
  const featureViewsLabel = `Feature Views ${fvSuccess && featureViews && featureViews.length > 0 ? `(${featureViews.length})` : ""}`;
  const featureListLabel = `Features ${featSuccess && features && features.length > 0 ? `(${features.length})` : ""}`;
  const featureServicesLabel = `Feature Services ${fsSuccess && featureServices ? `(${featureServices.length})` : ""}`;
  const savedDatasetsLabel = `Datasets ${sdSuccess && savedDatasets ? `(${savedDatasets.length})` : ""}`;
  const labelViewsLabel = `Label Views ${lvSuccess && labelViews && labelViews.length > 0 ? `(${labelViews.length})` : ""}`;

  const baseUrl = `/p/${projectName}`;

  const featureManagementItems: React.ComponentProps<
    typeof EuiSideNav
  >["items"] = [
    {
      name: dataSourcesLabel,
      id: htmlIdGenerator("dataSources")(),
      icon: <EuiIcon type={DataSourceIcon} />,
      renderItem: (props) => (
        <Link {...props} to={`${baseUrl}/data-source`} />
      ),
      isSelected: useMatchSubpath(`${baseUrl}/data-source`),
    },
    {
      name: entitiesLabel,
      id: htmlIdGenerator("entities")(),
      icon: <EuiIcon type={EntityIcon} />,
      renderItem: (props) => <Link {...props} to={`${baseUrl}/entity`} />,
      isSelected: useMatchSubpath(`${baseUrl}/entity`),
    },
    {
      name: featureListLabel,
      id: htmlIdGenerator("featureList")(),
      icon: <EuiIcon type={FeatureIcon} />,
      renderItem: (props) => <Link {...props} to={`${baseUrl}/features`} />,
      isSelected: useMatchSubpath(`${baseUrl}/features`),
    },
    {
      name: featureViewsLabel,
      id: htmlIdGenerator("featureView")(),
      icon: <EuiIcon type={FeatureViewIcon} />,
      renderItem: (props) => (
        <Link {...props} to={`${baseUrl}/feature-view`} />
      ),
      isSelected: useMatchSubpath(`${baseUrl}/feature-view`),
    },
    {
      name: featureServicesLabel,
      id: htmlIdGenerator("featureService")(),
      icon: <EuiIcon type={FeatureServiceIcon} />,
      renderItem: (props) => (
        <Link {...props} to={`${baseUrl}/feature-service`} />
      ),
      isSelected: useMatchSubpath(`${baseUrl}/feature-service`),
    },
    {
      name: labelViewsLabel,
      id: htmlIdGenerator("labelViews")(),
      icon: <EuiIcon type={LabelViewIcon} />,
      renderItem: (props) => (
        <Link {...props} to={`${baseUrl}/label-view`} />
      ),
      isSelected: useMatchSubpath(`${baseUrl}/label-view`),
    },
    {
      name: savedDatasetsLabel,
      id: htmlIdGenerator("savedDatasets")(),
      icon: <EuiIcon type={DatasetIcon} />,
      renderItem: (props) => <Link {...props} to={`${baseUrl}/data-set`} />,
      isSelected: useMatchSubpath(`${baseUrl}/data-set`),
    },
    {
      name: "Permissions",
      id: htmlIdGenerator("permissions")(),
      icon: <EuiIcon type={PermissionsIcon} />,
      renderItem: (props) => (
        <Link {...props} to={`${baseUrl}/permissions`} />
      ),
      isSelected: useMatchSubpath(`${baseUrl}/permissions`),
    },
    {
      name: "Compute & Jobs",
      id: htmlIdGenerator("computeEngine")(),
      icon: <EuiIcon type={ComputeEngineIcon} />,
      renderItem: (props: any) => (
        <Link {...props} to={`${baseUrl}/compute-engine`} />
      ),
      isSelected: useMatchSubpath(`${baseUrl}/compute-engine`),
    },
  ];

  const sideNav: React.ComponentProps<typeof EuiSideNav>["items"] = [
    {
      name: "Home",
      id: htmlIdGenerator("home")(),
      icon: <EuiIcon type={HomeIcon} />,
      renderItem: (props) => <Link {...props} to={`${baseUrl}`} />,
      isSelected: useMatchSubpath(`${baseUrl}$`),
    },
    {
      name: "Lineage Graph",
      id: htmlIdGenerator("lineage")(),
      icon: <EuiIcon type="graphApp" />,
      renderItem: (props) => <Link {...props} to={`${baseUrl}/lineage`} />,
      isSelected: useMatchSubpath(`${baseUrl}/lineage`),
    },
    {
      name: (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          Feature Management
          <EuiIcon
            type={featureManagementOpen ? "arrowDown" : "arrowRight"}
            size="s"
          />
        </span>
      ),
      id: htmlIdGenerator("featureManagement")(),
      icon: <EuiIcon type="managementApp" />,
      onClick: () => setFeatureManagementOpen((v) => !v),
      isSelected: isInFeatureManagement,
      items: featureManagementOpen ? featureManagementItems : undefined,
    },
    {
      name: "Model Monitoring",
      id: htmlIdGenerator("modelMonitoring")(),
      icon: <EuiIcon type="monitoringApp" />,
      renderItem: (props) => (
        <Link {...props} to={`${baseUrl}/model-monitoring`} />
      ),
      isSelected: useMatchSubpath(`${baseUrl}/model-monitoring`),
    },
  ];

  if (collapsed) {
    return <CollapsedSidebar baseUrl={baseUrl} onExpand={onExpand} />;
  }

  return (
    <EuiSideNav
      aria-label="Project Level"
      mobileTitle="Feast"
      toggleOpenOnMobile={() => toggleOpenOnMobile()}
      isOpenOnMobile={isSideNavOpenOnMobile}
      items={sideNav}
    />
  );
};

const CollapsedSidebar = ({
  baseUrl,
  onExpand,
}: {
  baseUrl: string;
  onExpand?: () => void;
}) => {
  const topLevelItems: Array<{
    label: string;
    icon: React.ReactNode;
    to?: string;
  }> = [
    {
      label: "Home",
      icon: <EuiIcon type={HomeIcon} size="l" />,
      to: `${baseUrl}`,
    },
    {
      label: "Lineage Graph",
      icon: <EuiIcon type="graphApp" size="l" />,
      to: `${baseUrl}/lineage`,
    },
    {
      label: "Feature Management",
      icon: <EuiIcon type="managementApp" size="l" />,
    },
    {
      label: "Model Monitoring",
      icon: <EuiIcon type="monitoringApp" size="l" />,
      to: `${baseUrl}/model-monitoring`,
    },
  ];

  const iconButtonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    borderRadius: 8,
    cursor: "pointer",
    background: "transparent",
    border: "none",
    color: "inherit",
    textDecoration: "none",
  };

  return (
    <nav aria-label="Collapsed navigation">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
        }}
      >
        {topLevelItems.map((item) => (
          <EuiToolTip key={item.label} content={item.label} position="right">
            {item.to ? (
              <Link
                to={item.to}
                onClick={onExpand}
                aria-label={item.label}
                style={iconButtonStyle}
              >
                {item.icon}
              </Link>
            ) : (
              <button
                type="button"
                onClick={onExpand}
                aria-label={item.label}
                style={iconButtonStyle}
              >
                {item.icon}
              </button>
            )}
          </EuiToolTip>
        ))}
      </div>
    </nav>
  );
};

export default SideNav;
