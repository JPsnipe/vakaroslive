from __future__ import annotations

import argparse
import asyncio
import logging
from pathlib import Path
import ssl
from typing import Any

from aiohttp import web

from .ble_atlas2 import Atlas2BleClient
from .server import TelemetryHub, create_app


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="vakaroslive")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    parser.add_argument(
        "--https",
        action="store_true",
        help="Sirve UI por HTTPS (necesario para Web Bluetooth en Android). Requiere --certfile/--keyfile.",
    )
    parser.add_argument("--certfile", default=None, help="Ruta a certificado PEM (chain).")
    parser.add_argument("--keyfile", default=None, help="Ruta a clave privada PEM.")
    parser.add_argument(
        "--device",
        default=None,
        help="Dirección BLE (recomendado) o substring del nombre para auto-selección.",
    )
    parser.add_argument("--scan-timeout", default=8.0, type=float)
    parser.add_argument("--mock", action="store_true", help="Genera telemetría falsa.")
    parser.add_argument("--log-level", default="INFO")
    return parser.parse_args()


async def _run_site(
    app: web.Application, host: str, port: int, ssl_context: ssl.SSLContext | None
) -> web.AppRunner:
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, host=host, port=port, ssl_context=ssl_context)
    await site.start()
    return runner


async def _mock_telemetry(queue: asyncio.Queue[dict[str, Any]]) -> None:
    import math
    import time

    lat = 42.230282
    lon = -8.732954
    heading = 0.0

    queue.put_nowait(
        {
            "type": "status",
            "ts_ms": int(time.time() * 1000),
            "connected": True,
            "device_address": "mock",
            "error": None,
        }
    )

    while True:
        now_ms = int(time.time() * 1000)
        heading = (heading + 4.0) % 360.0
        lat += 0.00001 * math.cos(math.radians(heading))
        lon += 0.00001 * math.sin(math.radians(heading))
        queue.put_nowait(
            {
                "type": "telemetry_main",
                "ts_ms": now_ms,
                "msg_type": 0x02,
                "msg_subtype": 0x0A,
                "latitude": lat,
                "longitude": lon,
                "heading_deg": heading,
                "field_4": None,
                "field_5": None,
                "field_6": None,
                "raw_len": 35,
            }
        )
        await asyncio.sleep(0.2)


async def main() -> None:
    args = _parse_args()
    logging.basicConfig(
        level=getattr(logging, str(args.log_level).upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger = logging.getLogger("vakaroslive")

    event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=2000)

    persist_path = Path.cwd() / "logs" / "vakaroslive_state.json"
    hub = TelemetryHub(event_queue, persist_path=persist_path)
    ble = Atlas2BleClient(
        event_queue=event_queue,
        device_hint=args.device,
        scan_timeout=args.scan_timeout,
        logger=logging.getLogger("vakaroslive.ble"),
    )

    app = create_app(hub=hub, ble=ble)

    ssl_context: ssl.SSLContext | None = None
    scheme = "http"
    if args.https:
        if not args.certfile or not args.keyfile:
            raise SystemExit("HTTPS requiere --certfile y --keyfile (PEM).")
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(certfile=str(args.certfile), keyfile=str(args.keyfile))
        scheme = "https"

    runner = await _run_site(app, host=args.host, port=args.port, ssl_context=ssl_context)
    logger.info("UI: %s://%s:%s", scheme, args.host, args.port)

    tasks: list[asyncio.Task[Any]] = [
        asyncio.create_task(hub.run(), name="hub"),
    ]
    if args.mock:
        tasks.append(asyncio.create_task(_mock_telemetry(event_queue), name="mock"))
    else:
        tasks.append(asyncio.create_task(ble.run(), name="ble"))

    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await runner.cleanup()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        raise SystemExit(0)
