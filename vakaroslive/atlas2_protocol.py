from __future__ import annotations

import math
import struct
from dataclasses import dataclass

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


def _safe_f32(data: bytes, offset: int) -> float | None:
    if len(data) < offset + 4:
        return None
    value = struct.unpack_from("<f", data, offset)[0]
    if math.isnan(value):
        return None
    return value


def parse_telemetry_main(data: bytes) -> TelemetryMain | None:
    if len(data) < 20:
        return None
    if data[0] != 0x02:
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
        reserved_hex=data[2:8].hex(),
        tail_hex=data[32:35].hex() if len(data) >= 35 else None,
        raw_len=len(data),
    )


def parse_telemetry_compact(data: bytes) -> TelemetryCompact | None:
    if len(data) < 6:
        return None
    if data[0] != 0xFE:
        return None
    heading_raw = struct.unpack_from("<H", data, 2)[0]
    # Se han observado escalas x10 y x100 según firmware/captura.
    scale = 100.0 if heading_raw > 3600 else 10.0
    field_2 = struct.unpack_from("<H", data, 4)[0]
    return TelemetryCompact(
        msg_type=data[0],
        msg_subtype=data[1],
        heading_deg=heading_raw / scale,
        field_2=field_2,
        raw_len=len(data),
    )
