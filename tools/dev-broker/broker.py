# SPDX-License-Identifier: AGPL-3.0-or-later
"""Local development MQTT broker (amqtt).

For development only: no TLS, anonymous access, bound to localhost.
Production uses Mosquitto with mutual TLS (see docs/architecture.md).
"""

import asyncio
import logging
import os

from amqtt.broker import Broker

HOST = os.environ.get("OC_BROKER_HOST", "127.0.0.1")
PORT = int(os.environ.get("OC_BROKER_PORT", "1883"))

CONFIG = {
    "listeners": {"default": {"type": "tcp", "bind": f"{HOST}:{PORT}"}},
    "plugins": {
        "amqtt.plugins.authentication.AnonymousAuthPlugin": {"allow_anonymous": True},
    },
}


async def main() -> None:
    broker = Broker(CONFIG)
    await broker.start()
    logging.info("Dev MQTT broker listening on %s:%s (no TLS, anonymous)", HOST, PORT)
    try:
        await asyncio.Event().wait()
    finally:
        await broker.shutdown()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s broker %(levelname)s %(message)s")
    logging.getLogger("amqtt").setLevel(logging.WARNING)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
