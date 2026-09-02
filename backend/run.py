"""Start the Feast UI backend:  python run.py  (port from BACKEND_PORT, default 8001)."""
import os
import sys

import uvicorn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.config import build_config  # noqa: E402

_config = build_config()


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.environ.get("BACKEND_HOST", "0.0.0.0"),
        port=_config["port"],
        log_level="info",
    )
