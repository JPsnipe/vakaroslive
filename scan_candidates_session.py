import json
import base64
import struct

def haversine_m(lat1, lon1, lat2, lon2):
    import math
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def scan_candidates(path):
    with open(path, 'r') as f:
        data = json.load(f)
    
    entries = data.get("entries", [])
    for i, e in enumerate(entries):
        if e.get("kind") == "ble_rx" and e.get("chan") == "main":
            raw = base64.b64decode(e["raw_b64"])
            if len(raw) < 16: continue
            
            for off in range(len(raw) - 15):
                try:
                    a_lat, a_lon, b_lat, b_lon = struct.unpack_from("<ffff", raw, off)
                    if 35 < abs(a_lat) < 65 and 35 < abs(b_lat) < 65:
                        dist = haversine_m(a_lat, a_lon, b_lat, b_lon)
                        if 5 <= dist <= 2000:
                            print(f"Found candidate at entry {i}, off {off}: {a_lat, a_lon} -> {b_lat, b_lon} (len {dist:.1f}m)")
                except:
                    continue

if __name__ == "__main__":
    scan_candidates(r"c:\JAVIER\VAKAROSLIVE\vakaroslive_session_2025-12-23T10-39-05.775Z.json")
