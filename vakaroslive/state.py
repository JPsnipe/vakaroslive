from __future__ import annotations

import math
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
    start_line_follow_atlas: bool = True
    windward: GeoPoint | None = None
    leeward_port: GeoPoint | None = None
    leeward_starboard: GeoPoint | None = None
    wing_mark: GeoPoint | None = None
    reach_mark: GeoPoint | None = None
    course_type: str | None = None  # "W/L" | "Triangle" | "Trapezoid"
    source: str | None = None  # "manual" | "atlas"
    target: str | None = None  # "mark" | "windward" | "leeward_port" | "leeward_starboard" | "leeward_gate" | "wing" | "reach"

    def to_dict(self) -> dict[str, Any]:
        return {
            "mark": self.mark.to_dict() if self.mark else None,
            "start_pin": self.start_pin.to_dict() if self.start_pin else None,
            "start_rcb": self.start_rcb.to_dict() if self.start_rcb else None,
            "start_line_follow_atlas": bool(self.start_line_follow_atlas),
            "windward": self.windward.to_dict() if self.windward else None,
            "leeward_port": self.leeward_port.to_dict() if self.leeward_port else None,
            "leeward_starboard": self.leeward_starboard.to_dict()
            if self.leeward_starboard
            else None,
            "wing_mark": self.wing_mark.to_dict() if self.wing_mark else None,
            "reach_mark": self.reach_mark.to_dict() if self.reach_mark else None,
            "course_type": self.course_type,
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
        if "start_line_follow_atlas" in data:
            marks.start_line_follow_atlas = bool(data.get("start_line_follow_atlas"))
        if data.get("windward"):
            marks.windward = GeoPoint.from_dict(data["windward"])
        if data.get("leeward_port"):
            marks.leeward_port = GeoPoint.from_dict(data["leeward_port"])
        if data.get("leeward_starboard"):
            marks.leeward_starboard = GeoPoint.from_dict(data["leeward_starboard"])
        if data.get("wing_mark"):
            marks.wing_mark = GeoPoint.from_dict(data["wing_mark"])
        if data.get("reach_mark"):
            marks.reach_mark = GeoPoint.from_dict(data["reach_mark"])
        if "course_type" in data:
            marks.course_type = data.get("course_type")
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
    _compact_sog_scale: int | None = field(default=None, repr=False)
    _compact_sog_scale_hits: dict[int, int] = field(
        default_factory=lambda: {100: 0, 10: 0, 1: 0}, repr=False
    )
    _last_compact_sog_ts_ms: int | None = field(default=None, repr=False)
    _last_derived_sog_knots: float | None = field(default=None, repr=False)
    _last_field6_sog_ts_ms: int | None = field(default=None, repr=False)
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

    def _decode_sog_knots_from_compact_field2(self, field_2: Any) -> float | None:
        if not isinstance(field_2, int):
            return None
        raw = int(field_2)
        if raw < 0 or raw > 65535:
            return None

        if self._compact_sog_scale is not None:
            v = raw / float(self._compact_sog_scale)
            return v if 0.0 <= v <= 60.0 else None

        candidates: list[tuple[int, float]] = []
        for scale in (100, 10, 1):
            v = raw / float(scale)
            if 0.0 <= v <= 60.0:
                candidates.append((scale, v))
        if not candidates:
            return None

        ref = self._last_derived_sog_knots
        has_ref = isinstance(ref, (int, float)) and math.isfinite(ref) and ref > 0.05
        if has_ref:
            candidates.sort(key=lambda sv: abs(sv[1] - float(ref)))
            scale, v = candidates[0]
            tol = max(2.5, float(ref) * 0.8)
            if abs(v - float(ref)) > tol:
                for s in (100, 10, 1):
                    self._compact_sog_scale_hits[s] = max(
                        0, int(self._compact_sog_scale_hits.get(s, 0)) - 1
                    )
                return None

            self._compact_sog_scale_hits[scale] = int(
                self._compact_sog_scale_hits.get(scale, 0)
            ) + 1
            for s in (100, 10, 1):
                if s != scale:
                    self._compact_sog_scale_hits[s] = max(
                        0, int(self._compact_sog_scale_hits.get(s, 0)) - 1
                    )
            if int(self._compact_sog_scale_hits.get(scale, 0)) >= 3:
                self._compact_sog_scale = scale
            return v

        # Sin referencia: usa la escala más probable (más resolución) en rango.
        candidates.sort(key=lambda sv: sv[0], reverse=True)
        scale, v = candidates[0]
        self._compact_sog_scale_hits[scale] = int(self._compact_sog_scale_hits.get(scale, 0)) + 1
        if int(self._compact_sog_scale_hits.get(scale, 0)) >= 5:
            self._compact_sog_scale = scale
        return v

    def to_persisted_json(self) -> str:
        return json.dumps({"marks": self.marks.to_dict()}, ensure_ascii=False, indent=2)

    def _apply_atlas_start_line_candidates(self, event: dict[str, Any]) -> bool:
        source = str(event.get("source") or "")
        from_command = source.startswith("command_")
        if not self.marks.start_line_follow_atlas and not from_command:
            return False
        candidates = event.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            return False
        if not isinstance(self.latitude, (int, float)) or not isinstance(
            self.longitude, (int, float)
        ):
            return False

        boat_lat = float(self.latitude)
        boat_lon = float(self.longitude)
        existing_pin = self.marks.start_pin
        existing_rcb = self.marks.start_rcb

        def parse_candidate(c: Any) -> tuple[float, float, float, float, float] | None:
            if not isinstance(c, dict):
                return None
            try:
                a_lat = float(c.get("a_lat"))
                a_lon = float(c.get("a_lon"))
                b_lat = float(c.get("b_lat"))
                b_lon = float(c.get("b_lon"))
            except Exception:
                return None
            if not all(math.isfinite(v) for v in (a_lat, a_lon, b_lat, b_lon)):
                return None
            line_len = c.get("line_len_m")
            if isinstance(line_len, (int, float)) and math.isfinite(line_len):
                line_len_m = float(line_len)
            else:
                line_len_m = haversine_m(a_lat, a_lon, b_lat, b_lon)
            return a_lat, a_lon, b_lat, b_lon, line_len_m

        def assignment_cost(
            a_lat: float, a_lon: float, b_lat: float, b_lon: float
        ) -> tuple[float, bool]:
            """Returns (cost, swapped) to map candidates to (pin, rcb)."""
            if existing_pin and existing_rcb:
                cost_direct = haversine_m(existing_pin.lat, existing_pin.lon, a_lat, a_lon) + haversine_m(
                    existing_rcb.lat, existing_rcb.lon, b_lat, b_lon
                )
                cost_swap = haversine_m(existing_pin.lat, existing_pin.lon, b_lat, b_lon) + haversine_m(
                    existing_rcb.lat, existing_rcb.lon, a_lat, a_lon
                )
                if cost_swap < cost_direct:
                    return cost_swap, True
                return cost_direct, False
            if existing_pin:
                da = haversine_m(existing_pin.lat, existing_pin.lon, a_lat, a_lon)
                db = haversine_m(existing_pin.lat, existing_pin.lon, b_lat, b_lon)
                return (db, True) if db < da else (da, False)
            if existing_rcb:
                da = haversine_m(existing_rcb.lat, existing_rcb.lon, a_lat, a_lon)
                db = haversine_m(existing_rcb.lat, existing_rcb.lon, b_lat, b_lon)
                return (db, True) if db < da else (da, False)
            return 0.0, False

        best: tuple[float, float, float, float, bool] | None = None
        best_score: float | None = None
        for raw_c in candidates:
            parsed = parse_candidate(raw_c)
            if not parsed:
                continue
            a_lat, a_lon, b_lat, b_lon, line_len_m = parsed

            # Reglas heurísticas: longitud plausible y cerca del barco.
            if not (5.0 <= line_len_m <= 2500.0):
                continue
            dist_a = haversine_m(boat_lat, boat_lon, a_lat, a_lon)
            dist_b = haversine_m(boat_lat, boat_lon, b_lat, b_lon)
            if dist_a > 20_000.0 or dist_b > 20_000.0:
                continue

            match_cost, swapped = assignment_cost(a_lat, a_lon, b_lat, b_lon)
            score = match_cost if (existing_pin or existing_rcb) else (dist_a + dist_b)
            if best_score is None or score < best_score:
                best_score = score
                best = (a_lat, a_lon, b_lat, b_lon, swapped)

        if best is None:
            return False
        a_lat, a_lon, b_lat, b_lon, swapped = best
        pin_lat, pin_lon, rcb_lat, rcb_lon = (
            (b_lat, b_lon, a_lat, a_lon) if swapped else (a_lat, a_lon, b_lat, b_lon)
        )

        ts_ms = int(event.get("ts_ms") or int(time.time() * 1000))

        def differs(prev: GeoPoint | None, lat: float, lon: float) -> bool:
            if prev is None:
                return True
            return haversine_m(prev.lat, prev.lon, lat, lon) > 0.5

        changed = False
        if differs(self.marks.start_pin, pin_lat, pin_lon):
            self.marks.start_pin = GeoPoint(lat=pin_lat, lon=pin_lon, ts_ms=ts_ms)
            changed = True
        if differs(self.marks.start_rcb, rcb_lat, rcb_lon):
            self.marks.start_rcb = GeoPoint(lat=rcb_lat, lon=rcb_lon, ts_ms=ts_ms)
            changed = True
        if changed:
            self.marks.source = "atlas"
        return changed

    def apply_event(self, event: dict[str, Any]) -> bool:
        now_ms = int(time.time() * 1000)
        self.last_event_ts_ms = int(event.get("ts_ms") or now_ms)

        etype = event.get("type")
        if etype == "atlas_start_line_candidates":
            return self._apply_atlas_start_line_candidates(event)

        if etype == "status":
            self.connected = bool(event.get("connected"))
            self.device_address = event.get("device_address")
            self.last_error = event.get("error")
            if not self.connected:
                self._fix_history.clear()
                self.sog_knots = None
                self.cog_deg = None
                self._compact_sog_scale = None
                self._compact_sog_scale_hits = {100: 0, 10: 0, 1: 0}
                self._last_compact_sog_ts_ms = None
                self._last_derived_sog_knots = None
                self._last_field6_sog_ts_ms = None
            return False

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
            return False

        if etype != "telemetry_main":
            return False

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
                    self._last_derived_sog_knots = sog_kn
                    if (
                        self._last_compact_sog_ts_ms is None
                        or int(self.last_event_ts_ms) - int(self._last_compact_sog_ts_ms) > 2500
                        or self.sog_knots is None
                    ):
                        self.sog_knots = sog_kn
                    self.cog_deg = bearing_deg(first_lat, first_lon, last_lat, last_lon)

        if isinstance(heading, (int, float)):
            self.heading_deg = float(heading)

        if isinstance(field_4, (int, float)):
            self.main_field_4 = float(field_4)
        if isinstance(field_5, (int, float)):
            self.main_field_5 = float(field_5)
        if isinstance(field_6, (int, float)) and math.isfinite(field_6):
            self.main_field_6 = float(field_6)
            # Field 6 parece ser SOG en m/s: exponer como nudos para el dashboard.
            sog_kn = float(field_6) * MPS_TO_KNOTS
            if 0.0 <= sog_kn <= 60.0:
                self.sog_knots = sog_kn
                self._last_field6_sog_ts_ms = int(self.last_event_ts_ms)
        if isinstance(reserved_hex, str):
            self.main_reserved_hex = reserved_hex
        if isinstance(tail_hex, str) or tail_hex is None:
            self.main_tail_hex = tail_hex
        if isinstance(raw_len, int):
            self.main_raw_len = raw_len
        return False
