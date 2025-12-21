from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

from .util_geo import MPS_TO_KNOTS, bearing_deg, haversine_m


@dataclass
class GeoPoint:
    lat: float
    lon: float
    ts_ms: int | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"lat": self.lat, "lon": self.lon}
        if self.ts_ms is not None:
            out["ts_ms"] = self.ts_ms
        return out

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "GeoPoint":
        return GeoPoint(
            lat=float(data["lat"]),
            lon=float(data["lon"]),
            ts_ms=int(data["ts_ms"]) if data.get("ts_ms") is not None else None,
        )


@dataclass
class RaceMarks:
    mark: GeoPoint | None = None
    start_pin: GeoPoint | None = None
    start_rcb: GeoPoint | None = None
    windward: GeoPoint | None = None
    leeward_port: GeoPoint | None = None
    leeward_starboard: GeoPoint | None = None
    source: str | None = None  # "manual" | "atlas"
    target: str | None = None  # "mark" | "windward" | "leeward_port" | "leeward_starboard" | "leeward_gate"

    def to_dict(self) -> dict[str, Any]:
        return {
            "mark": self.mark.to_dict() if self.mark else None,
            "start_pin": self.start_pin.to_dict() if self.start_pin else None,
            "start_rcb": self.start_rcb.to_dict() if self.start_rcb else None,
            "windward": self.windward.to_dict() if self.windward else None,
            "leeward_port": self.leeward_port.to_dict() if self.leeward_port else None,
            "leeward_starboard": self.leeward_starboard.to_dict()
            if self.leeward_starboard
            else None,
            "source": self.source,
            "target": self.target,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "RaceMarks":
        marks = RaceMarks()
        if data.get("mark"):
            marks.mark = GeoPoint.from_dict(data["mark"])
        if data.get("start_pin"):
            marks.start_pin = GeoPoint.from_dict(data["start_pin"])
        if data.get("start_rcb"):
            marks.start_rcb = GeoPoint.from_dict(data["start_rcb"])
        if data.get("windward"):
            marks.windward = GeoPoint.from_dict(data["windward"])
        if data.get("leeward_port"):
            marks.leeward_port = GeoPoint.from_dict(data["leeward_port"])
        if data.get("leeward_starboard"):
            marks.leeward_starboard = GeoPoint.from_dict(data["leeward_starboard"])
        marks.source = data.get("source")
        marks.target = data.get("target")
        return marks


@dataclass
class AtlasState:
    connected: bool = False
    device_address: str | None = None
    last_event_ts_ms: int | None = None

    latitude: float | None = None
    longitude: float | None = None

    heading_deg: float | None = None
    heading_compact_deg: float | None = None

    sog_knots: float | None = None
    cog_deg: float | None = None

    main_field_4: float | None = None
    main_field_5: float | None = None
    main_field_6: float | None = None
    main_reserved_hex: str | None = None
    main_tail_hex: str | None = None
    main_raw_len: int | None = None

    compact_field_2: int | None = None
    compact_raw_len: int | None = None

    last_error: str | None = None

    _fix_history: list[tuple[int, float, float]] = field(
        default_factory=list, repr=False
    )  # (ts_ms, lat, lon)
    marks: RaceMarks = field(default_factory=RaceMarks)

    def to_dict(self) -> dict[str, Any]:
        return {
            "connected": self.connected,
            "device_address": self.device_address,
            "last_event_ts_ms": self.last_event_ts_ms,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "heading_deg": self.heading_deg,
            "heading_compact_deg": self.heading_compact_deg,
            "sog_knots": self.sog_knots,
            "cog_deg": self.cog_deg,
            "main_field_4": self.main_field_4,
            "main_field_5": self.main_field_5,
            "main_field_6": self.main_field_6,
            "main_reserved_hex": self.main_reserved_hex,
            "main_tail_hex": self.main_tail_hex,
            "main_raw_len": self.main_raw_len,
            "compact_field_2": self.compact_field_2,
            "compact_raw_len": self.compact_raw_len,
            "last_error": self.last_error,
            "marks": self.marks.to_dict(),
        }

    def to_persisted_json(self) -> str:
        return json.dumps({"marks": self.marks.to_dict()}, ensure_ascii=False, indent=2)

    def apply_event(self, event: dict[str, Any]) -> None:
        now_ms = int(time.time() * 1000)
        self.last_event_ts_ms = int(event.get("ts_ms") or now_ms)

        etype = event.get("type")
        if etype == "status":
            self.connected = bool(event.get("connected"))
            self.device_address = event.get("device_address")
            self.last_error = event.get("error")
            if not self.connected:
                self._fix_history.clear()
                self.sog_knots = None
                self.cog_deg = None
            return

        if etype == "telemetry_compact":
            heading = event.get("heading_deg")
            if isinstance(heading, (int, float)):
                self.heading_compact_deg = float(heading)
            field_2 = event.get("field_2")
            if isinstance(field_2, int):
                self.compact_field_2 = field_2
            raw_len = event.get("raw_len")
            if isinstance(raw_len, int):
                self.compact_raw_len = raw_len
            return

        if etype != "telemetry_main":
            return

        lat = event.get("latitude")
        lon = event.get("longitude")
        heading = event.get("heading_deg")
        field_4 = event.get("field_4")
        field_5 = event.get("field_5")
        field_6 = event.get("field_6")
        reserved_hex = event.get("reserved_hex")
        tail_hex = event.get("tail_hex")
        raw_len = event.get("raw_len")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            self.latitude = float(lat)
            self.longitude = float(lon)

            ts_ms = int(self.last_event_ts_ms)
            self._fix_history.append((ts_ms, self.latitude, self.longitude))
            cutoff = ts_ms - 4000
            while len(self._fix_history) > 2 and self._fix_history[0][0] < cutoff:
                self._fix_history.pop(0)

            if len(self._fix_history) >= 2:
                first_ts, first_lat, first_lon = self._fix_history[0]
                last_ts, last_lat, last_lon = self._fix_history[-1]
                dt_s = max(0.001, (last_ts - first_ts) / 1000.0)
                dist_m = haversine_m(first_lat, first_lon, last_lat, last_lon)
                sog_kn = (dist_m / dt_s) * MPS_TO_KNOTS
                if sog_kn <= 40.0:
                    self.sog_knots = sog_kn
                    self.cog_deg = bearing_deg(first_lat, first_lon, last_lat, last_lon)

        if isinstance(heading, (int, float)):
            self.heading_deg = float(heading)

        if isinstance(field_4, (int, float)):
            self.main_field_4 = float(field_4)
        if isinstance(field_5, (int, float)):
            self.main_field_5 = float(field_5)
        if isinstance(field_6, (int, float)):
            self.main_field_6 = float(field_6)
        if isinstance(reserved_hex, str):
            self.main_reserved_hex = reserved_hex
        if isinstance(tail_hex, str) or tail_hex is None:
            self.main_tail_hex = tail_hex
        if isinstance(raw_len, int):
            self.main_raw_len = raw_len
