from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
import time
from typing import Any

from aiohttp import WSMsgType, web

from .ble_atlas2 import Atlas2BleClient
from .state import GeoPoint, RaceMarks


class TelemetryHub:
    def __init__(
        self, event_queue: asyncio.Queue[dict[str, Any]], persist_path: Path | None = None
    ) -> None:
        self._event_queue = event_queue
        from .state import AtlasState

        self.state = AtlasState()
        self._clients: set[web.WebSocketResponse] = set()
        self._persist_path = persist_path
        self._logger = logging.getLogger(__name__)
        self._load_persisted()

    def _load_persisted(self) -> None:
        if self._persist_path is None:
            return
        try:
            raw = self._persist_path.read_text(encoding="utf-8")
            data = json.loads(raw)
            marks = data.get("marks") or {}
            self.state.marks = RaceMarks.from_dict(marks)
        except FileNotFoundError:
            return
        except Exception as exc:
            self._logger.warning("Failed to load persisted marks: %s", exc)
            return

    def _save_persisted(self) -> None:
        if self._persist_path is None:
            return
        try:
            self._persist_path.parent.mkdir(parents=True, exist_ok=True)
            self._persist_path.write_text(self.state.to_persisted_json(), encoding="utf-8")
        except Exception:
            return

    async def broadcast_state(self, event: dict[str, Any] | None) -> None:
        await self.broadcast({"type": "state", "state": self.state.to_dict(), "event": event})

    async def handle_command(self, cmd: dict[str, Any]) -> None:
        ctype = cmd.get("type")
        now_ms = int(time.time() * 1000)

        def point_from_current() -> GeoPoint | None:
            if self.state.latitude is None or self.state.longitude is None:
                return None
            return GeoPoint(lat=self.state.latitude, lon=self.state.longitude, ts_ms=now_ms)

        def point_from_payload(key: str) -> GeoPoint | None:
            value = cmd.get(key)
            if not isinstance(value, dict):
                return None
            try:
                return GeoPoint.from_dict(value)
            except Exception:
                return None

        def point_from_cmd_or_current() -> GeoPoint | None:
            return point_from_payload("point") or point_from_current()

        if ctype == "set_mark":
            point = point_from_cmd_or_current()
            if not point:
                return
            self.state.marks.mark = point
            self.state.marks.source = "manual"
        elif ctype == "clear_mark":
            self.state.marks.mark = None
        elif ctype == "set_windward":
            point = point_from_cmd_or_current()
            if not point:
                return
            self.state.marks.windward = point
            self.state.marks.source = "manual"
        elif ctype == "clear_windward":
            self.state.marks.windward = None
        elif ctype == "set_leeward_port":
            point = point_from_cmd_or_current()
            if not point:
                return
            self.state.marks.leeward_port = point
            self.state.marks.source = "manual"
        elif ctype == "set_leeward_starboard":
            point = point_from_cmd_or_current()
            if not point:
                return
            self.state.marks.leeward_starboard = point
            self.state.marks.source = "manual"
        elif ctype == "set_wing":
            point = point_from_cmd_or_current()
            if not point:
                return
            self.state.marks.wing_mark = point
            self.state.marks.source = "manual"
        elif ctype == "set_reach":
            point = point_from_cmd_or_current()
            if not point:
                return
            self.state.marks.reach_mark = point
            self.state.marks.source = "manual"
        elif ctype == "clear_leeward_gate":
            self.state.marks.leeward_port = None
            self.state.marks.leeward_starboard = None
        elif ctype == "clear_race_marks":
            self.state.marks.windward = None
            self.state.marks.leeward_port = None
            self.state.marks.leeward_starboard = None
            self.state.marks.wing_mark = None
            self.state.marks.reach_mark = None
            if self.state.marks.target in {
                "windward",
                "leeward_port",
                "leeward_starboard",
                "leeward_gate",
                "wing",
                "reach",
            }:
                self.state.marks.target = None
        elif ctype == "set_start_pin":
            point = point_from_cmd_or_current()
            if not point:
                return
            self.state.marks.start_pin = point
            self.state.marks.source = "manual"
            self.state.marks.start_line_follow_atlas = False
        elif ctype == "set_start_rcb":
            point = point_from_cmd_or_current()
            if not point:
                return
            self.state.marks.start_rcb = point
            self.state.marks.source = "manual"
            self.state.marks.start_line_follow_atlas = False
        elif ctype == "clear_start_line":
            self.state.marks.start_pin = None
            self.state.marks.start_rcb = None
        elif ctype == "set_start_line":
            pin = point_from_payload("start_pin")
            rcb = point_from_payload("start_rcb")
            if pin and rcb:
                self.state.marks.start_pin = pin
                self.state.marks.start_rcb = rcb
                self.state.marks.source = "manual"
                self.state.marks.start_line_follow_atlas = False
            else:
                return
        elif ctype == "set_start_line_follow_atlas":
            enabled = cmd.get("enabled")
            if not isinstance(enabled, bool):
                return
            self.state.marks.start_line_follow_atlas = enabled
        elif ctype == "set_course_type":
            course_type = cmd.get("course_type")
            allowed = {"W/L", "Triangle", "Trapezoid"}
            if course_type not in allowed:
                return
            self.state.marks.course_type = course_type
            self.state.marks.source = "manual"
        elif ctype == "set_target":
            target = cmd.get("target")
            allowed = {
                None,
                "mark",
                "windward",
                "leeward_port",
                "leeward_starboard",
                "leeward_gate",
                "wing",
                "reach",
            }
            if target not in allowed:
                return
            self.state.marks.target = target
        else:
            return

        self._save_persisted()
        await self.broadcast_state(event={"type": "cmd", "cmd": ctype, "ts_ms": now_ms})

    async def broadcast(self, payload: dict[str, Any]) -> None:
        to_remove: list[web.WebSocketResponse] = []
        for ws in self._clients:
            if ws.closed:
                to_remove.append(ws)
                continue
            try:
                await ws.send_json(payload)
            except Exception:
                to_remove.append(ws)
        for ws in to_remove:
            self._clients.discard(ws)

    async def run(self) -> None:
        while True:
            event = await self._event_queue.get()
            marks_changed = self.state.apply_event(event)
            if marks_changed:
                self._save_persisted()
            await self.broadcast_state(event=event)

    async def register(self, ws: web.WebSocketResponse) -> None:
        self._clients.add(ws)
        await ws.send_json({"type": "state", "state": self.state.to_dict(), "event": None})

    def unregister(self, ws: web.WebSocketResponse) -> None:
        self._clients.discard(ws)


class LooseWebSocketResponse(web.WebSocketResponse):
    def _check_origin(self, origin: str) -> bool:
        return True


def create_app(hub: TelemetryHub, ble: Atlas2BleClient) -> web.Application:
    app = web.Application()
    static_dir = Path(__file__).with_name("static")

    async def index(_: web.Request) -> web.FileResponse:
        return web.FileResponse(static_dir / "index.html")

    def _file_handler(filename: str):
        async def handler(_: web.Request) -> web.FileResponse:
            return web.FileResponse(static_dir / filename)

        return handler

    async def ws_handler(request: web.Request) -> web.StreamResponse:
        ws = LooseWebSocketResponse(heartbeat=20)
        await ws.prepare(request)
        await hub.register(ws)

        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    payload = json.loads(msg.data)
                except Exception:
                    continue
                if isinstance(payload, dict):
                    await hub.handle_command(payload)
        finally:
            hub.unregister(ws)
        return ws

    async def api_state(_: web.Request) -> web.Response:
        return web.json_response(hub.state.to_dict())

    async def api_scan(request: web.Request) -> web.Response:
        timeout = float(request.query.get("timeout") or 6.0)
        try:
            devices = await ble.scan(timeout=timeout)
            return web.json_response({"devices": devices})
        except RuntimeError as exc:
            return web.json_response({"devices": [], "error": str(exc)}, status=503)

    async def api_cmd(request: web.Request) -> web.Response:
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "invalid_json"}, status=400)
        if not isinstance(payload, dict):
            return web.json_response({"error": "invalid_payload"}, status=400)
        await hub.handle_command(payload)
        return web.json_response(hub.state.to_dict())

    app.router.add_get("/", index)
    for name in [
        "app.js",
        "styles.css",
        "manifest.webmanifest",
        "sw.js",
        "icon.svg",
        "leaflet.css",
        "leaflet.js",
    ]:
        app.router.add_get(f"/{name}", _file_handler(name))
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/api/state", api_state)
    app.router.add_get("/api/scan", api_scan)
    app.router.add_post("/api/cmd", api_cmd)

    return app
