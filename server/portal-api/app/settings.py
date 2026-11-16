# SPDX-License-Identifier: AGPL-3.0-or-later
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

DATABASE_URL = os.environ.get("OC_DATABASE_URL", f"sqlite:///{BASE_DIR / 'data' / 'opencomms.db'}")
MQTT_HOST = os.environ.get("OC_MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.environ.get("OC_MQTT_PORT", "1883"))
MQTT_ENABLED = os.environ.get("OC_MQTT_ENABLED", "1") == "1"
# Dev-only endpoints (device provisioning without a CA). Disable in production.
DEV_MODE = os.environ.get("OC_DEV_MODE", "1") == "1"
WEB_DIST = Path(os.environ.get("OC_WEB_DIST", BASE_DIR.parent / "portal-web" / "dist"))

TOPIC_ROOT = "oc/dev"
KEYS = ("A", "B", "C", "D")
