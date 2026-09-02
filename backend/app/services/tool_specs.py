"""
Tool definitions for the AI agent (OpenAI function calling format) and the
mapping that resolves each tool name to a real backend request.

Every tool is served by the FastAPI backend itself:

  * kind "registry" -> {REGISTRY_URL}/api/v1/{path}
  * kind "online"   -> {ONLINE_URL}/{path}

`query` builds query-string parameters from the model-supplied arguments and
`json_body` builds the JSON body (used by the online POST tools).
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional

TOOL_SPECS: Dict[str, Dict[str, Any]] = {
    # ------------------------------------------------------------------
    # Registry tools
    # ------------------------------------------------------------------
    "list_projects": {"kind": "registry", "method": "GET", "path": "/projects"},
    "get_project": {"kind": "registry", "method": "GET", "path": "/projects/:name"},
    "list_entities": {
        "kind": "registry",
        "method": "GET",
        "path": "/entities",
        "all_path": "/entities/all",
        "query": lambda a: {"project": a.get("project")},
    },
    "get_entity": {
        "kind": "registry",
        "method": "GET",
        "path": "/entities/:name",
    },
    "list_data_sources": {
        "kind": "registry",
        "method": "GET",
        "path": "/data_sources",
        "all_path": "/data_sources/all",
        "query": lambda a: {"project": a.get("project"), "tags": a.get("tags")},
    },
    "get_data_source": {
        "kind": "registry",
        "method": "GET",
        "path": "/data_sources/:name",
    },
    "list_feature_views": {
        "kind": "registry",
        "method": "GET",
        "path": "/feature_views",
        "all_path": "/feature_views/all",
        "query": lambda a: {
            "project": a.get("project"),
            "entity": a.get("entity"),
            "feature": a.get("feature"),
            "data_source": a.get("data_source"),
            "tags": a.get("tags"),
        },
    },
    "get_feature_view": {
        "kind": "registry",
        "method": "GET",
        "path": "/feature_views/:name",
    },
    "list_feature_services": {
        "kind": "registry",
        "method": "GET",
        "path": "/feature_services",
        "all_path": "/feature_services/all",
        "query": lambda a: {"project": a.get("project"), "tags": a.get("tags")},
    },
    "get_feature_service": {
        "kind": "registry",
        "method": "GET",
        "path": "/feature_services/:name",
    },
    "list_features": {
        "kind": "registry",
        "method": "GET",
        "path": "/features",
        "all_path": "/features/all",
        "query": lambda a: {
            "project": a.get("project"),
            "feature_view": a.get("feature_view"),
        },
    },
    "get_feature": {
        "kind": "registry",
        "method": "GET",
        "path": "/features/:feature_view/:name",
    },
    "list_labels": {
        "kind": "registry",
        "method": "GET",
        "path": "/labels",
        "all_path": "/labels/all",
        "query": lambda a: {
            "project": a.get("project"),
            "feature_view": a.get("feature_view"),
        },
    },
    "list_label_views": {
        "kind": "registry",
        "method": "GET",
        "path": "/label_views",
        "all_path": "/label_views/all",
        "query": lambda a: {"project": a.get("project"), "tags": a.get("tags")},
    },
    "get_label_view": {
        "kind": "registry",
        "method": "GET",
        "path": "/label_views/:name",
    },
    "list_saved_datasets": {
        "kind": "registry",
        "method": "GET",
        "path": "/saved_datasets",
        "all_path": "/saved_datasets/all",
        "query": lambda a: {
            "project": a.get("project"),
            "namespace": a.get("namespace"),
            "collection": a.get("collection"),
        },
    },
    "get_saved_dataset": {
        "kind": "registry",
        "method": "GET",
        "path": "/saved_datasets/:name",
    },
    "get_saved_dataset_data": {
        "kind": "registry",
        "method": "GET",
        "path": "/saved_datasets/data/:name",
        "query": lambda a: {"project": a.get("project"), "limit": a.get("limit")},
    },
    "list_saved_dataset_jobs": {
        "kind": "registry",
        "method": "GET",
        "path": "/saved_datasets/jobs",
        "query": lambda a: {"project": a.get("project"), "status": a.get("status")},
    },
    "list_compute_engines": {
        "kind": "registry",
        "method": "GET",
        "path": "/compute_engines",
        "all_path": "/compute_engines/all",
        "query": lambda a: {"project": a.get("project")},
    },
    "list_lineage_objects": {
        "kind": "registry",
        "method": "GET",
        "path": "/lineage/objects/:object_type/:object_name",
        "query": lambda a: {"project": a.get("project")},
    },
    "list_lineage_complete": {
        "kind": "registry",
        "method": "GET",
        "path": "/lineage/complete",
        "query": lambda a: {"project": a.get("project")},
    },
    "get_registry_lineage": {
        "kind": "registry",
        "method": "GET",
        "path": "/lineage/registry/all",
    },
    "list_materialization_jobs": {
        "kind": "registry",
        "method": "GET",
        "path": "/materialization_jobs",
        "query": lambda a: {
            "project": a.get("project"),
            "status": a.get("status"),
            "feature_view": a.get("feature_view"),
        },
    },
    "get_monitoring_features": {
        "kind": "registry",
        "method": "GET",
        "path": "/monitoring/metrics/features",
        "query": lambda a: {
            "project": a.get("project"),
            "feature_view_name": a.get("feature_view"),
            "feature_name": a.get("feature_name"),
            "granularity": a.get("granularity"),
            "start_date": a.get("start_date"),
            "end_date": a.get("end_date"),
        },
    },
    "get_monitoring_feature_views": {
        "kind": "registry",
        "method": "GET",
        "path": "/monitoring/metrics/feature_views",
        "query": lambda a: {
            "project": a.get("project"),
            "feature_view_name": a.get("feature_view"),
            "granularity": a.get("granularity"),
            "start_date": a.get("start_date"),
            "end_date": a.get("end_date"),
        },
    },
    "get_monitoring_timeseries": {
        "kind": "registry",
        "method": "GET",
        "path": "/monitoring/metrics/timeseries",
        "query": lambda a: {
            "project": a.get("project"),
            "feature_view_name": a.get("feature_view"),
            "feature_name": a.get("feature_name"),
            "granularity": a.get("granularity"),
            "start_date": a.get("start_date"),
            "end_date": a.get("end_date"),
        },
    },
    "list_permissions": {
        "kind": "registry",
        "method": "GET",
        "path": "/permissions",
        "query": lambda a: {"project": a.get("project")},
    },
    "search_resources": {
        "kind": "registry",
        "method": "GET",
        "path": "/search",
        "query": lambda a: {"query": a.get("query"), "projects": a.get("projects")},
    },
    "get_resource_counts": {
        "kind": "registry",
        "method": "GET",
        "path": "/metrics/resource_counts",
    },
    "get_popular_tags": {
        "kind": "registry",
        "method": "GET",
        "path": "/metrics/popular_tags",
    },
    "get_recently_visited": {
        "kind": "registry",
        "method": "GET",
        "path": "/metrics/recently_visited",
        "query": lambda a: {"project": a.get("project")},
    },
    # ------------------------------------------------------------------
    # Online serving tools
    # ------------------------------------------------------------------
    "get_online_features": {
        "kind": "online",
        "method": "POST",
        "path": "/get-online-features",
        "json_body": lambda a: a,
        "description": (
            "Retrieve online feature values in real time. Provide "
            '"features" (list of "feature_view:feature" names) and "entities" '
            "(list of entity key dicts)."
        ),
    },
    "search_online": {
        "kind": "online",
        "method": "GET",
        "path": "/search",
        "query": lambda a: a,
        "description": "Full-text search across the online store.",
    },
    "list_vector_stores": {
        "kind": "online",
        "method": "GET",
        "path": "/v1/vector_stores",
        "description": "List all vector stores in the online serving API.",
    },
    "get_vector_store": {
        "kind": "online",
        "method": "GET",
        "path": "/v1/vector_stores/:vector_store_id",
        "description": "Get details of a vector store by id.",
    },
    "search_vector_store": {
        "kind": "online",
        "method": "POST",
        "path": "/v1/vector_stores/:vector_store_id/search",
        "json_body": lambda a: {
            k: v
            for k, v in a.items()
            if k != "vector_store_id"
        },
        "description": (
            "Similarity search inside a vector store. Pass vector_store_id, "
            "query embedding and any top_k / filters the API accepts."
        ),
    },
    "write_to_online_store": {
        "kind": "online",
        "method": "POST",
        "path": "/write-to-online-store",
        "json_body": lambda a: a,
        "description": "Write feature values to the online store.",
    },
    "push_data": {
        "kind": "online",
        "method": "POST",
        "path": "/push",
        "json_body": lambda a: a,
        "description": "Push data to the online store for real-time features.",
    },
    "materialize_online": {
        "kind": "online",
        "method": "POST",
        "path": "/materialize",
        "json_body": lambda a: a,
        "description": "Materialize feature values from the offline store into the online store.",
    },
    "materialize_incremental_online": {
        "kind": "online",
        "method": "POST",
        "path": "/materialize-incremental",
        "json_body": lambda a: a,
        "description": "Incrementally materialize feature values into the online store.",
    },
}


def _fn(name: str, description: str, properties: dict, required: Optional[list] = None):
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                **({"required": required} if required else {}),
            },
        },
    }


def _opt(description: str, ptype: str = "string"):
    return {"type": ptype, "description": description}


TOOL_DEFS: list = [
    _fn("list_projects", "List all projects in the feature platform", {}),
    _fn(
        "list_entities",
        "List entities, optionally filtered by project (use the project name returned by list_projects)",
        {"project": _opt("Optional project name")},
    ),
    _fn(
        "get_entity",
        "Get details of a single entity by name (join key, value type, description, etc.)",
        {"name": _opt("Entity name")},
        ["name"],
    ),
    _fn(
        "list_data_sources",
        "List data sources, optionally filtered by project",
        {"project": _opt("Optional project name")},
    ),
    _fn(
        "get_data_source",
        "Get details of a single data source by name (type, timestamp field, configuration, etc.)",
        {"name": _opt("Data source name")},
        ["name"],
    ),
    _fn(
        "list_feature_views",
        "List feature views, optionally filtered by project",
        {"project": _opt("Optional project name")},
    ),
    _fn(
        "get_feature_view",
        "Get details of a single feature view by name (features, entities, TTL, etc.)",
        {"name": _opt("Feature view name")},
        ["name"],
    ),
    _fn(
        "list_feature_services",
        "List feature services, optionally filtered by project",
        {"project": _opt("Optional project name")},
    ),
    _fn(
        "get_feature_service",
        "Get details of a single feature service by name (which feature views it includes)",
        {"name": _opt("Feature service name")},
        ["name"],
    ),
    _fn(
        "list_features",
        "List features, optionally filtered by project",
        {"project": _opt("Optional project name")},
    ),
    _fn(
        "get_feature",
        "Get details of a single feature by feature view and feature name",
        {"feature_view": _opt("Feature view name"), "name": _opt("Feature name")},
        ["feature_view", "name"],
    ),
    _fn(
        "list_labels",
        "List labels, optionally filtered by project",
        {"project": _opt("Optional project name")},
    ),
    _fn(
        "list_label_views",
        "List label views, optionally filtered by project",
        {"project": _opt("Optional project name")},
    ),
    _fn(
        "get_label_view",
        "Get details of a single label view by name",
        {"name": _opt("Label view name")},
        ["name"],
    ),
    _fn(
        "list_saved_datasets",
        "List saved datasets, optionally filtered by project",
        {"project": _opt("Optional project name")},
    ),
    _fn(
        "get_saved_dataset",
        "Get details of a single saved dataset by name",
        {"name": _opt("Dataset name")},
        ["name"],
    ),
    _fn(
        "list_compute_engines",
        "List compute engines",
        {},
    ),
    _fn(
        "search_resources",
        "Search entities, feature views, data sources, and other resources by keyword",
        {"query": _opt("Search keyword")},
        ["query"],
    ),
    _fn(
        "get_resource_counts",
        "Get the number of resources of each type in the feature platform",
        {},
    ),
    _fn(
        "get_popular_tags",
        "Get the list of popular tags",
        {},
    ),
    _fn(
        "get_registry_lineage",
        "Get lineage data of the registry, optionally filtered by project",
        {"project": _opt("Optional project name")},
    ),
    _fn(
        "get_project",
        "Get details of a single project by name (description, creation time, etc.)",
        {"name": _opt("Project name")},
        ["name"],
    ),
    _fn(
        "get_saved_dataset_data",
        "Get the actual data rows of a saved dataset by name, optionally limited to N rows",
        {"name": _opt("Saved dataset name"), "project": _opt("Optional project name"),
         "limit": _opt("Optional maximum number of rows", "integer")},
        ["name"],
    ),
    _fn(
        "list_saved_dataset_jobs",
        "List saved dataset jobs, optionally filtered by project or status",
        {"project": _opt("Optional project name"), "status": _opt("Optional job status")},
    ),
    _fn(
        "list_lineage_objects",
        "Get lineage (upstream/downstream) of a single registry object by object type and name",
        {"object_type": _opt("Object type, e.g. feature_view, data_source, feature_service"),
         "object_name": _opt("Object name"), "project": _opt("Optional project name")},
        ["object_type", "object_name"],
    ),
    _fn(
        "list_lineage_complete",
        "Get complete lineage of the registry, optionally filtered by project",
        {"project": _opt("Optional project name")},
    ),
    _fn(
        "list_materialization_jobs",
        "List materialization jobs, optionally filtered by project, status, or feature view",
        {"project": _opt("Optional project name"), "status": _opt("Optional job status filter"),
         "feature_view": _opt("Optional feature view name")},
    ),
    _fn(
        "get_monitoring_features",
        "Get monitoring metrics (freshness/quality) for features, optionally filtered by project, feature view, feature, or date range",
        {"project": _opt("Optional project name"),
         "feature_view": _opt("Optional feature view name"),
         "feature_name": _opt("Optional feature name"),
         "granularity": _opt("Optional time granularity"),
         "start_date": _opt("Optional start date (YYYY-MM-DD)"),
         "end_date": _opt("Optional end date (YYYY-MM-DD)")},
    ),
    _fn(
        "get_monitoring_feature_views",
        "Get monitoring metrics for feature views, optionally filtered by project or feature view",
        {"project": _opt("Optional project name"),
         "feature_view": _opt("Optional feature view name"),
         "granularity": _opt("Optional time granularity"),
         "start_date": _opt("Optional start date (YYYY-MM-DD)"),
         "end_date": _opt("Optional end date (YYYY-MM-DD)")},
    ),
    _fn(
        "get_monitoring_timeseries",
        "Get time-series monitoring data, optionally filtered by project, feature view, feature, or date range",
        {"project": _opt("Optional project name"),
         "feature_view": _opt("Optional feature view name"),
         "feature_name": _opt("Optional feature name"),
         "granularity": _opt("Optional time granularity"),
         "start_date": _opt("Optional start date (YYYY-MM-DD)"),
         "end_date": _opt("Optional end date (YYYY-MM-DD)")},
    ),
    _fn(
        "list_permissions",
        "List permissions, optionally filtered by project",
        {"project": _opt("Optional project name")},
    ),
    _fn(
        "get_recently_visited",
        "Get recently visited resources in the feature platform",
        {"project": _opt("Optional project name")},
    ),
    # --- Online serving tools ---
    _fn(
        "get_online_features",
        "Retrieve online feature values in real time. Provide 'features' (list of 'feature_view:feature' names) and 'entities' (list of entity key dicts).",
        {
            "features": _opt("List of feature names like 'driver_stats:avg_daily_trips'", "array"),
            "entities": _opt("List of entity key dicts", "array"),
        },
        ["features", "entities"],
    ),
    _fn(
        "search_online",
        "Full-text search across the online store",
        {"query": _opt("Search query")},
        ["query"],
    ),
    _fn("list_vector_stores", "List all vector stores in the online serving API", {}),
    _fn(
        "get_vector_store",
        "Get details of a vector store by id",
        {"vector_store_id": _opt("Vector store id")},
        ["vector_store_id"],
    ),
    _fn(
        "search_vector_store",
        "Similarity search inside a vector store. Pass vector_store_id and a query embedding (plus any top_k / filters the API accepts).",
        {"vector_store_id": _opt("Vector store id"),
         "embedding": _opt("Query embedding vector", "array"),
         "top_k": _opt("Optional number of results", "integer")},
        ["vector_store_id"],
    ),
    _fn(
        "write_to_online_store",
        "Write feature values to the online store",
        {"feature_view": _opt("Feature view name"),
         "data": _opt("Rows to write", "array")},
    ),
    _fn(
        "push_data",
        "Push data to the online store for real-time features",
        {"feature_view": _opt("Feature view name"),
         "data": _opt("Rows to push", "array")},
    ),
    _fn(
        "materialize_online",
        "Materialize feature values from the offline store into the online store",
        {"feature_view": _opt("Feature view name"),
         "start_date": _opt("Start datetime"),
         "end_date": _opt("End datetime")},
    ),
    _fn(
        "materialize_incremental_online",
        "Incrementally materialize feature values into the online store",
        {"feature_view": _opt("Feature view name"),
         "end_date": _opt("End datetime")},
    ),
]
