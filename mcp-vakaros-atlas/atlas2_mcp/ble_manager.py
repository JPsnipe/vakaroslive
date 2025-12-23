from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import bleak
from bleak import BleakClient, BleakScanner

from .protocol import (
    DEVICE_NAME_FILTER,
    VAKAROS_CHAR_TELEMETRY_COMPACT,
    VAKAROS_CHAR_TELEMETRY_MAIN,
    VAKAROS_CHAR_COMMAND_1,
    VAKAROS_SERVICE_UUID,
    parse_telemetry_compact,
    parse_telemetry_main,
    extract_start_line_candidates,
)

class Atlas2BleManager:
    def __init__(
        self,
        event_callback: callable,
        logger: logging.Logger | None = None,
    ) -> None:
        self._event_callback = event_callback
        self._logger = logger or logging.getLogger(__name__)
        self._stop = asyncio.Event()
        self._disconnected = asyncio.Event()
        self._current_client: BleakClient | None = None

    async def scan(self, timeout: float = 5.0) -> list[dict[str, Any]]:
        devices = await BleakScanner.discover(timeout=timeout)
        results = []
        for d in devices:
            name = getattr(d, "name", None) or ""
            metadata = getattr(d, "metadata", None) or {}
            uuids = [str(u).lower() for u in (metadata.get("uuids") or [])]
            
            if DEVICE_NAME_FILTER.lower() in name.lower() or VAKAROS_SERVICE_UUID.lower() in uuids:
                results.append({
                    "name": name,
                    "address": d.address,
                    "rssi": getattr(d, "rssi", None),
                })
        return results

    def _on_disconnect(self, client: BleakClient) -> None:
        self._logger.info("Device disconnected: %s", client.address)
        self._disconnected.set()
        self._event_callback({"type": "status", "connected": False, "device_address": client.address})

    async def run(self, address_hint: str | None = None) -> None:
        while not self._stop.is_set():
            address = address_hint
            if not address:
                self._logger.info("Scanning for Atlas 2...")
                found = await self.scan()
                if found:
                    address = found[0]["address"]
                else:
                    await asyncio.sleep(2.0)
                    continue

            self._disconnected.clear()
            self._logger.info("Connecting to %s...", address)
            
            try:
                async with BleakClient(address, disconnected_callback=self._on_disconnect) as client:
                    self._current_client = client
                    self._logger.info("Connected to %s", address)
                    
                    data_received_event = asyncio.Event()

                    # Proactive Push: Activate streaming immediately
                    async def trigger_streaming():
                        self._logger.info("Sending proactive WAKE-UP (0x01) to Command 1...")
                        try:
                            await self.write_command(bytes([0x01]), VAKAROS_CHAR_COMMAND_1)
                        except Exception as e:
                            self._logger.warning(f"Could not auto-start streaming: {e}")
                        
                        # Wait 5 seconds and check if we have data. If not, retry once.
                        await asyncio.sleep(5.0)
                        if not data_received_event.is_set():
                            self._logger.warning("No data received after 5s. Retrying WAKE-UP...")
                            try:
                                await self.write_command(bytes([0x01]), VAKAROS_CHAR_COMMAND_1)
                            except: pass

                    asyncio.create_task(trigger_streaming())

                    self._event_callback({"type": "status", "connected": True, "device_address": address})

                    def on_main(_: int, data: bytearray):
                        data_received_event.set()
                        parsed = parse_telemetry_main(bytes(data))
                        if parsed:
                            self._event_callback({
                                "type": "telemetry_main",
                                "ts_ms": int(time.time() * 1000),
                                **parsed.__dict__
                            })
                        
                        # Automated Start Line Detection
                        candidates = extract_start_line_candidates(bytes(data))
                        if candidates:
                            self._event_callback({
                                "type": "atlas_start_line_candidates",
                                "ts_ms": int(time.time() * 1000),
                                "source": "ble_auto",
                                "candidates": candidates
                            })

                    def on_compact(_: int, data: bytearray):
                        data_received_event.set()
                        parsed = parse_telemetry_compact(bytes(data))
                        if parsed:
                            self._event_callback({
                                "type": "telemetry_compact",
                                "ts_ms": int(time.time() * 1000),
                                **parsed.__dict__
                            })

                    # Try to start notifications
                    try:
                        await client.start_notify(VAKAROS_CHAR_TELEMETRY_MAIN, on_main)
                        await client.start_notify(VAKAROS_CHAR_TELEMETRY_COMPACT, on_compact)
                        self._logger.info("Notifications started.")
                    except Exception as e:
                        self._logger.warning("Could not start notifications: %s", e)

                    # Polling fallback loop (Windows compatibility)
                    async def poll_loop():
                        last_main = None
                        last_compact = None
                        while not self._disconnected.is_set() and not self._stop.is_set():
                            try:
                                # Read Main Telemetry
                                raw_main = bytes(await client.read_gatt_char(VAKAROS_CHAR_TELEMETRY_MAIN))
                                if raw_main and raw_main != last_main:
                                    on_main(0, bytearray(raw_main))
                                    last_main = raw_main
                                
                                # Read Compact Telemetry
                                raw_compact = bytes(await client.read_gatt_char(VAKAROS_CHAR_TELEMETRY_COMPACT))
                                if raw_compact and raw_compact != last_compact:
                                    on_compact(0, bytearray(raw_compact))
                                    last_compact = raw_compact
                                
                            except Exception as e:
                                self._logger.debug("Poll error: %s", e)
                            await asyncio.sleep(0.5)

                    poll_task = asyncio.create_task(poll_loop())
                    
                    # Wait for manual stop or disconnection
                    await self._disconnected.wait()
                    poll_task.cancel()
            except Exception as e:
                self._logger.error("BLE Error: %s", e)
                self._event_callback({"type": "status", "connected": False, "error": str(e)})
                await asyncio.sleep(5.0)

    async def write_command(self, payload: bytes, char_uuid: str = VAKAROS_CHAR_COMMAND_1) -> bool:
        if not self._current_client or not self._current_client.is_connected:
            return False
        try:
            await self._current_client.write_gatt_char(char_uuid, payload, response=True)
            return True
        except Exception as e:
            if self._logger:
                self._logger.error(f"Error writing command: {e}")
            return False

    async def stop(self) -> None:
        self._stop.set()
        self._disconnected.set()
        if self._current_client:
            try:
                await self._current_client.disconnect()
            except Exception:
                pass
            self._current_client = None
        self._event_callback({"type": "status", "connected": False, "device_address": None})
