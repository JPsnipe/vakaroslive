from __future__ import annotations

import asyncio
import contextlib
import logging
import re
import time
from typing import Any

try:
    from bleak import BleakClient, BleakScanner
except ModuleNotFoundError:  # pragma: no cover
    BleakClient = None  # type: ignore[assignment]
    BleakScanner = None  # type: ignore[assignment]

from .atlas2_protocol import (
    DEVICE_NAME_FILTER,
    VAKAROS_CHAR_TELEMETRY_COMPACT,
    VAKAROS_CHAR_TELEMETRY_MAIN,
    VAKAROS_SERVICE_UUID,
    parse_telemetry_compact,
    parse_telemetry_main,
)

_MAC_RE = re.compile(r"^[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}$")


class Atlas2BleClient:
    def __init__(
        self,
        event_queue: asyncio.Queue[dict[str, Any]],
        device_hint: str | None,
        scan_timeout: float,
        logger: logging.Logger | None = None,
    ) -> None:
        self._event_queue = event_queue
        self._device_hint = device_hint
        self._scan_timeout = scan_timeout
        self._logger = logger or logging.getLogger(__name__)

        self._stop = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._disconnected = asyncio.Event()

    async def stop(self) -> None:
        self._stop.set()

    async def scan(self, timeout: float | None = None) -> list[dict[str, Any]]:
        if BleakScanner is None:
            raise RuntimeError("Dependencia faltante: instala `bleak` (pip -r requirements.txt).")
        timeout = float(timeout or self._scan_timeout)
        devices = await BleakScanner.discover(timeout=timeout)

        results: list[dict[str, Any]] = []
        for d in devices:
            metadata = getattr(d, "metadata", None) or {}
            uuids = [str(u) for u in (metadata.get("uuids") or [])]
            results.append(
                {
                    "name": getattr(d, "name", None),
                    "address": getattr(d, "address", None),
                    "rssi": getattr(d, "rssi", None),
                    "uuids": uuids,
                }
            )
        return results

    def _enqueue(self, event: dict[str, Any]) -> None:
        try:
            self._event_queue.put_nowait(event)
        except asyncio.QueueFull:
            try:
                _ = self._event_queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            try:
                self._event_queue.put_nowait(event)
            except asyncio.QueueFull:
                return

    def _emit(self, event: dict[str, Any]) -> None:
        if self._loop is None:
            return
        self._loop.call_soon_threadsafe(self._enqueue, event)

    @staticmethod
    def _looks_like_address(value: str) -> bool:
        v = value.strip()
        if _MAC_RE.match(v):
            return True
        if len(v) >= 16 and ":" in v:
            return True
        # Windows a veces expone direcciones como GUID/UUID.
        if len(v) >= 32 and v.count("-") >= 2 and all(
            c.isalnum() or c == "-" for c in v
        ):
            return True
        return False

    async def _find_device_address(self) -> str | None:
        name_hint: str | None = None
        if self._device_hint:
            hint = self._device_hint.strip()
            if self._looks_like_address(hint):
                return hint
            name_hint = hint.lower()

        devices = await self.scan()
        for d in devices:
            name = (d.get("name") or "").lower()
            address = d.get("address")
            if not address:
                continue
            uuids = [str(u).lower() for u in (d.get("uuids") or [])]

            if name_hint and name_hint in name:
                return address
            if DEVICE_NAME_FILTER.lower() in name:
                return address
            if VAKAROS_SERVICE_UUID.lower() in uuids:
                return address

        return None

    def _on_disconnect(self, _: BleakClient) -> None:
        if self._loop is None:
            return
        self._loop.call_soon_threadsafe(self._disconnected.set)

    async def run(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._emit({"type": "status", "ts_ms": int(time.time() * 1000), "connected": False})

        if BleakClient is None or BleakScanner is None:
            self._logger.error(
                "`bleak` no esta instalado. Ejecuta: pip install -r requirements.txt"
            )
            self._emit(
                {
                    "type": "status",
                    "ts_ms": int(time.time() * 1000),
                    "connected": False,
                    "device_address": None,
                    "error": "Dependencia faltante: instala `bleak`.",
                }
            )
            return

        while not self._stop.is_set():
            address = await self._find_device_address()
            if not address:
                self._emit(
                    {
                        "type": "status",
                        "ts_ms": int(time.time() * 1000),
                        "connected": False,
                        "device_address": None,
                        "error": "Atlas 2 no encontrado (scan).",
                    }
                )
                await asyncio.sleep(2.0)
                continue

            self._disconnected.clear()
            self._logger.info("Conectando a %s ...", address)
            client: BleakClient | None = None
            connected = False
            had_error = False
            warned_no_data = False
            cleared_no_data = False
            first_data = asyncio.Event()
            try:
                client = BleakClient(address, disconnected_callback=self._on_disconnect)
                await client.connect()
                connected = True

                self._emit(
                    {
                        "type": "status",
                        "ts_ms": int(time.time() * 1000),
                        "connected": True,
                        "device_address": address,
                        "error": None,
                    }
                )

                def mark_data_received() -> None:
                    nonlocal warned_no_data, cleared_no_data
                    if not first_data.is_set():
                        first_data.set()
                    if warned_no_data and not cleared_no_data:
                        cleared_no_data = True
                        self._logger.info("Telemetría recibida.")
                        self._emit(
                            {
                                "type": "status",
                                "ts_ms": int(time.time() * 1000),
                                "connected": True,
                                "device_address": address,
                                "error": None,
                            }
                        )

                def on_main(_: int, data: bytearray) -> None:
                    raw = bytes(data)
                    parsed = parse_telemetry_main(raw)
                    if not parsed:
                        return
                    self._emit(
                        {
                            "type": "telemetry_main",
                            "ts_ms": int(time.time() * 1000),
                            "raw_hex": raw.hex(),
                            **parsed.__dict__,
                        }
                    )
                    if self._loop is not None:
                        self._loop.call_soon_threadsafe(mark_data_received)

                def on_compact(_: int, data: bytearray) -> None:
                    raw = bytes(data)
                    parsed = parse_telemetry_compact(raw)
                    if not parsed:
                        return
                    self._emit(
                        {
                            "type": "telemetry_compact",
                            "ts_ms": int(time.time() * 1000),
                            "raw_hex": raw.hex(),
                            **parsed.__dict__,
                        }
                    )
                    if self._loop is not None:
                        self._loop.call_soon_threadsafe(mark_data_received)

                await client.start_notify(VAKAROS_CHAR_TELEMETRY_MAIN, on_main)
                await client.start_notify(VAKAROS_CHAR_TELEMETRY_COMPACT, on_compact)
                self._logger.info("Notificaciones activas. Escuchando...")

                async def poll_telemetry_loop() -> None:
                    # Fallback: en algunos setups (WinRT) no llegan notificaciones, pero el valor se
                    # puede leer por GATT. Poll a ~5 Hz para soporte en tiempo real.
                    poll_interval_s = 0.2
                    last_main: bytes | None = None
                    last_compact: bytes | None = None

                    while not self._stop.is_set() and not self._disconnected.is_set():
                        try:
                            raw_main = bytes(
                                await client.read_gatt_char(VAKAROS_CHAR_TELEMETRY_MAIN)
                            )
                            if raw_main and raw_main != last_main:
                                parsed = parse_telemetry_main(raw_main)
                                if parsed:
                                    self._emit(
                                        {
                                            "type": "telemetry_main",
                                            "ts_ms": int(time.time() * 1000),
                                            "raw_hex": raw_main.hex(),
                                            **parsed.__dict__,
                                        }
                                    )
                                    mark_data_received()
                                last_main = raw_main

                            raw_compact = bytes(
                                await client.read_gatt_char(VAKAROS_CHAR_TELEMETRY_COMPACT)
                            )
                            if raw_compact and raw_compact != last_compact:
                                parsed = parse_telemetry_compact(raw_compact)
                                if parsed:
                                    self._emit(
                                        {
                                            "type": "telemetry_compact",
                                            "ts_ms": int(time.time() * 1000),
                                            "raw_hex": raw_compact.hex(),
                                            **parsed.__dict__,
                                        }
                                    )
                                    mark_data_received()
                                last_compact = raw_compact
                        except Exception as exc:
                            self._logger.debug("Poll read failed: %s", exc)
                            break

                        await asyncio.sleep(poll_interval_s)

                async def no_data_watchdog() -> None:
                    nonlocal warned_no_data
                    try:
                        await asyncio.wait_for(first_data.wait(), timeout=6.0)
                    except asyncio.TimeoutError:
                        warned_no_data = True
                        self._logger.warning(
                            "Conectado pero sin telemetría (si Vakaros Connect está conectado, desconéctalo)."
                        )
                        self._emit(
                            {
                                "type": "status",
                                "ts_ms": int(time.time() * 1000),
                                "connected": True,
                                "device_address": address,
                                "error": "Conectado pero sin telemetría (¿Vakaros Connect conectado?).",
                            }
                        )
                        # Fallback inmediato: empieza polling.
                        if poll_task is None:
                            self._logger.info("Fallback: activando polling por lectura GATT...")
                            start_polling()

                poll_task: asyncio.Task[None] | None = None

                def start_polling() -> None:
                    nonlocal poll_task
                    if poll_task is None or poll_task.done():
                        poll_task = asyncio.create_task(poll_telemetry_loop(), name="poll_telemetry")

                watch_task = asyncio.create_task(no_data_watchdog(), name="no_data_watchdog")
                # En la práctica, en Windows a veces NO llegan notifies aunque el valor cambie.
                # Arrancamos polling tras un pequeño delay si no llega nada.
                async def delayed_poll_start() -> None:
                    await asyncio.sleep(1.5)
                    if not first_data.is_set():
                        self._logger.info("Sin notificaciones; activando polling...")
                        start_polling()

                delayed_poll_task = asyncio.create_task(
                    delayed_poll_start(), name="delayed_poll_start"
                )
                stop_task = asyncio.create_task(self._stop.wait(), name="stop_wait")
                disconnected_task = asyncio.create_task(
                    self._disconnected.wait(), name="disconnected_wait"
                )
                done, pending = await asyncio.wait(
                    [stop_task, disconnected_task],
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for task in pending:
                    task.cancel()
                for task in pending:
                    with contextlib.suppress(asyncio.CancelledError):
                        await task
                delayed_poll_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await delayed_poll_task
                watch_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await watch_task
                if poll_task is not None:
                    poll_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await poll_task
            except Exception as exc:
                had_error = True
                self._logger.exception("Error BLE: %s", exc)
                self._emit(
                    {
                        "type": "status",
                        "ts_ms": int(time.time() * 1000),
                        "connected": False,
                        "device_address": address,
                        "error": str(exc),
                    }
                )
                await asyncio.sleep(2.0)
            finally:
                if client is not None:
                    try:
                        if client.is_connected:
                            await client.disconnect()
                    except Exception:
                        pass
                if connected and not had_error:
                    self._emit(
                        {
                            "type": "status",
                            "ts_ms": int(time.time() * 1000),
                            "connected": False,
                            "device_address": address,
                            "error": None,
                        }
                    )
