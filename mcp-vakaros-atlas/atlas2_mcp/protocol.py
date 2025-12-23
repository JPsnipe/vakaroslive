from __future__ import annotations

import math
import struct
from dataclasses import dataclass

# Constants
VAKAROS_SERVICE_UUID = "ac510001-0000-5a11-0076-616b61726f73"
VAKAROS_CHAR_COMMAND_1 = "ac510002-0000-5a11-0076-616b61726f73"
VAKAROS_CHAR_TELEMETRY_MAIN = "ac510003-0000-5a11-0076-616b61726f73"
VAKAROS_CHAR_COMMAND_2 = "ac510004-0000-5a11-0076-616b61726f73"
VAKAROS_CHAR_TELEMETRY_COMPACT = "ac510005-0000-5a11-0076-616b61726f73"

DEVICE_NAME_FILTER = "Atlas"

@dataclass(frozen=True)
class TelemetryMain:
    msg_type: int
    msg_subtype: int
    latitude: float | None
    longitude: float | None
    heading_deg: float | None
    field_4: float | None
    field_5: float | None
    field_6: float | None
    cog_test_deg: float | None
    reserved_hex: str
    tail_hex: str | None
    raw_len: int

@dataclass(frozen=True)
class TelemetryCompact:
    msg_type: int
    msg_subtype: int
    heading_deg: float
    field_2: int
    raw_len: int

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance between two points in meters using haversine formula."""
    R = 6371000.0  # Earth radius
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (math.sin(dphi / 2) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def _safe_f32(data: bytes, offset: int) -> float | None:
    if len(data) < offset + 4:
        return None
    value = struct.unpack_from("<f", data, offset)[0]
    if math.isnan(value):
        return None
    return value

def parse_telemetry_main(data: bytes) -> TelemetryMain | None:
    if len(data) < 32: # Minimum for the fields up to field_6
        return None
    if data[0] != 0x02 or data[1] != 0x0A:
        return None
    return TelemetryMain(
        msg_type=data[0],
        msg_subtype=data[1],
        latitude=_safe_f32(data, 8),
        longitude=_safe_f32(data, 12),
        heading_deg=_safe_f32(data, 16),
        field_4=_safe_f32(data, 20),
        field_5=_safe_f32(data, 24),
        field_6=_safe_f32(data, 28),
        cog_test_deg=_safe_f32(data, 32), # Corrected offset
        reserved_hex=data[2:8].hex(),
        tail_hex=data[32:].hex() if len(data) > 32 else None,
        raw_len=len(data),
    )

def parse_telemetry_compact(data: bytes) -> TelemetryCompact | None:
    if len(data) < 6:
        return None
    if data[0] != 0xFE:
        return None
    heading_raw = struct.unpack_from("<H", data, 2)[0]
    scale = 100.0 if heading_raw > 3600 else 10.0
    field_2 = struct.unpack_from("<H", data, 4)[0]
    return TelemetryCompact(
        msg_type=data[0],
        msg_subtype=data[1],
        heading_deg=heading_raw / scale,
        field_2=field_2,
        raw_len=len(data),
    )

def extract_start_line_candidates(
    data: bytes, *, min_len_m: float = 5.0, max_len_m: float = 2000.0
) -> list[dict[str, float | int]]:
    if len(data) < 16:
        return []

    def ok_lat_lon(lat: float, lon: float) -> bool:
        if not (math.isfinite(lat) and math.isfinite(lon)):
            return False
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
            return False
        if abs(lat) < 1e-6 and abs(lon) < 1e-6:
            return False
        return True

    out: list[dict[str, float | int]] = []
    seen: set[tuple[float, float, float, float]] = set()
    for off in range(0, len(data) - 16 + 1):
        try:
            a_lat, a_lon, b_lat, b_lon = struct.unpack_from("<ffff", data, off)
        except struct.error:
            break
        if not ok_lat_lon(a_lat, a_lon) or not ok_lat_lon(b_lat, b_lon):
            continue
        line_len = haversine_m(a_lat, a_lon, b_lat, b_lon)
        if not (min_len_m <= line_len <= max_len_m):
            continue

        key = (round(a_lat, 6), round(a_lon, 6), round(b_lat, 6), round(b_lon, 6))
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "offset": off,
                "a_lat": float(a_lat),
                "a_lon": float(a_lon),
                "b_lat": float(b_lat),
                "b_lon": float(b_lon),
                "line_len_m": float(line_len),
            }
        )
        if len(out) >= 12:
            break
    return out
