from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Any

MPS_TO_KNOTS = 1.94384

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (math.sin(dphi / 2) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0

@dataclass
class GeoPoint:
    lat: float
    lon: float
    ts_ms: int | None = None

    def to_dict(self) -> dict[str, Any]:
        out = {"lat": self.lat, "lon": self.lon}
        if self.ts_ms is not None:
            out["ts_ms"] = self.ts_ms
        return out

@dataclass
class RaceMarks:
    mark: GeoPoint | None = None
    start_pin: GeoPoint | None = None
    start_rcb: GeoPoint | None = None
    windward: GeoPoint | None = None
    leeward_port: GeoPoint | None = None
    leeward_starboard: GeoPoint | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "mark": self.mark.to_dict() if self.mark else None,
            "start_pin": self.start_pin.to_dict() if self.start_pin else None,
            "start_rcb": self.start_rcb.to_dict() if self.start_rcb else None,
            "windward": self.windward.to_dict() if self.windward else None,
            "leeward_port": self.leeward_port.to_dict() if self.leeward_port else None,
            "leeward_starboard": self.leeward_starboard.to_dict() if self.leeward_starboard else None,
        }

@dataclass
class AtlasState:
    connected: bool = False
    device_address: str | None = None
    last_event_ts_ms: int | None = None

    latitude: float | None = None
    longitude: float | None = None

    heading_deg: float | None = None
    sog_knots: float | None = None
    cog_deg: float | None = None

    marks: RaceMarks = field(default_factory=RaceMarks)
    
    # Unfiltered Metadata & Raw Fields
    pitch_deg: float | None = None  # field_4
    heel_deg: float | None = None   # field_5
    v_mps: float | None = None      # field_6
    cog_test_deg: float | None = None # Native COG field
    
    # Unfiltered Message Buffer (Last 5 messages raw)
    raw_history: list[dict[str, Any]] = field(default_factory=list)
    
    _fix_history: list[tuple[int, float, float]] = field(default_factory=list)
    _last_hdg_deg: float | None = field(default=None)
    _last_fusion_ts_ms: int | None = field(default=None)

    def to_dict(self) -> dict[str, Any]:
        return {
            "connected": self.connected,
            "device_address": self.device_address,
            "last_event_ts_ms": self.last_event_ts_ms,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "heading_deg": self.heading_deg,
            "pitch_deg": self.pitch_deg,
            "heel_deg": self.heel_deg,
            "sog_knots": self.sog_knots,
            "cog_deg": self.cog_deg,
            "cog_test_deg": self.cog_test_deg, # Added
            "v_mps": self.v_mps,
            "marks": self.marks.to_dict(),
            "raw_history": self.raw_history[-5:] # Show last 5 unfiltered messages
        }

    @staticmethod
    def _wrap_deg(v: float) -> float:
        res = v % 360.0
        return res + 360.0 if res < 0 else res

    @staticmethod
    def _delta_deg(a: float, b: float) -> float:
        return ((a - b + 540.0) % 360.0) - 180.0

    def _blend_deg(self, a_deg: float, b_deg: float, weight_b: float) -> float:
        w = max(0.0, min(1.0, weight_b))
        ar = math.radians(a_deg)
        br = math.radians(b_deg)
        x = (1.0 - w) * math.cos(ar) + w * math.cos(br)
        y = (1.0 - w) * math.sin(ar) + w * math.sin(br)
        if abs(x) < 1e-9 and abs(y) < 1e-9:
            return a_deg
        return self._wrap_deg(math.degrees(math.atan2(y, x)))

    def _apply_atlas_start_line_candidates(self, candidates: list[dict[str, Any]], ts_ms: int) -> bool:
        if not candidates or self.latitude is None or self.longitude is None:
            return False

        boat_lat, boat_lon = self.latitude, self.longitude
        best_cand = None
        min_score = float('inf')

        for c in candidates:
            # Simple heuristic: line closest to boat
            dist_a = haversine_m(boat_lat, boat_lon, c["a_lat"], c["a_lon"])
            dist_b = haversine_m(boat_lat, boat_lon, c["b_lat"], c["b_lon"])
            score = dist_a + dist_b
            if score < min_score:
                min_score = score
                best_cand = c

        if best_cand:
            # Update markers (Pin/RCB)
            # We assume A is Pin and B is RCB for now, or match existing
            self.marks.start_pin = GeoPoint(lat=best_cand["a_lat"], lon=best_cand["a_lon"], ts_ms=ts_ms)
            self.marks.start_rcb = GeoPoint(lat=best_cand["b_lat"], lon=best_cand["b_lon"], ts_ms=ts_ms)
            return True
        return False

    def apply_event(self, event: dict[str, Any]) -> None:
        # Keep unfiltered history
        self.raw_history.append(event)
        if len(self.raw_history) > 20:
            self.raw_history.pop(0)

        etype = event.get("type")
        ts_ms = event.get("ts_ms") or int(time.time() * 1000)
        self.last_event_ts_ms = ts_ms

        if etype == "status":
            self.connected = bool(event.get("connected"))
            self.device_address = event.get("device_address")
            if not self.connected:
                self._fix_history.clear()
                self._last_hdg_deg = None
        
        elif etype == "atlas_start_line_candidates":
            self._apply_atlas_start_line_candidates(event.get("candidates", []), ts_ms)

        elif etype in ("telemetry_compact", "telemetry_main"):
            hdg = event.get("heading_deg")
            lat = event.get("latitude")
            lon = event.get("longitude")
            field6 = event.get("field_6") # m/s SOG

            # 1. Update Heading (Instant)
            current_hdg: float | None = None
            if hdg is not None:
                current_hdg = float(hdg)
                self.heading_deg = current_hdg

            # 2. Update Position and GPS-derived COG/SOG
            cog_gps: float | None = None
            if lat is not None and lon is not None:
                self.latitude = float(lat)
                self.longitude = float(lon)
                self._fix_history.append((ts_ms, self.latitude, self.longitude))
                # 4s window
                cutoff = ts_ms - 4000
                while len(self._fix_history) > 2 and self._fix_history[0][0] < cutoff:
                    self._fix_history.pop(0)
                
                if len(self._fix_history) >= 2:
                    f_ts, f_lat, f_lon = self._fix_history[0]
                    l_ts, l_lat, l_lon = self._fix_history[-1]
                    dt = (l_ts - f_ts) / 1000.0
                    if dt > 0.1:
                        dist = haversine_m(f_lat, f_lon, l_lat, l_lon)
                        if dist > 0.5: # Min movement to trust bearing
                            cog_gps = bearing_deg(f_lat, f_lon, l_lat, l_lon)
                        if field6 is None:
                            self.sog_knots = (dist / dt) * MPS_TO_KNOTS

            # 3. Handle Field 6 SOG and Pitch/Heel
            if event.get("field_4") is not None:
                self.pitch_deg = float(event["field_4"])
            if event.get("field_5") is not None:
                self.heel_deg = float(event["field_5"])
            if event.get("cog_test_deg") is not None:
                self.cog_test_deg = float(event["cog_test_deg"])
            if field6 is not None:
                self.v_mps = float(field6)
                self.sog_knots = self.v_mps * MPS_TO_KNOTS

            # 4. ADVANCED FUSION (COG)
            sog = self.sog_knots or 0.0
            
            # Prediction: Dead Reckoning (COGy ~ COGx + deltaHeading)
            predicted_cog = self.cog_deg
            if predicted_cog is not None and current_hdg is not None and self._last_hdg_deg is not None:
                delta_hdg = self._delta_deg(current_hdg, self._last_hdg_deg)
                predicted_cog = self._wrap_deg(predicted_cog + delta_hdg)
            elif predicted_cog is None and current_hdg is not None:
                predicted_cog = current_hdg

            # Weighting Logic (Refined with Live stats)
            if cog_gps is not None:
                # Si vamos rápido (>2kn), confiamos 90% en GPS.
                # Si vamos lento (<0.5kn), confiamos 20% en GPS y 80% en inercia/heading.
                weight_gps = 0.2
                if sog > 2.0: weight_gps = 0.9
                elif sog > 0.5: weight_gps = 0.2 + (sog - 0.5) * (0.7 / 1.5)
                
                self.cog_deg = self._blend_deg(predicted_cog or current_hdg or 0.0, cog_gps, weight_gps)
            else:
                # No GPS update? Use predicted (Dead Reckoning)
                if predicted_cog is not None:
                    self.cog_deg = predicted_cog

            # Store last values for next cycle
            if current_hdg is not None:
                self._last_hdg_deg = current_hdg
            self._last_fusion_ts_ms = ts_ms
