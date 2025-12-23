import json
import base64
import struct

def analyze_session(path):
    with open(path, 'r') as f:
        data = json.load(f)
    
    entries = data.get("entries", [])
    print(f"Total entries: {len(entries)}")
    
    africa_count = 0
    valid_count = 0
    start_line_events = 0
    follow_atlas_toggles = []
    
    last_follow_atlas = None

    for i, e in enumerate(entries):
        if e.get("kind") == "dashboard":
            state = e.get("state", {})
            lat = state.get("latitude")
            lon = state.get("longitude")
            follow = state.get("marks", {}).get("start_line_follow_atlas")
            
            if follow != last_follow_atlas:
                follow_atlas_toggles.append((i, follow))
                last_follow_atlas = follow

            if lat is not None and lon is not None:
                if abs(lat) < 1.0 and abs(lon) < 1.0:
                    africa_count += 1
                else:
                    valid_count += 1
        
        if e.get("kind") == "ble_parsed" and e.get("chan") == "atlas_start_line_candidates":
            start_line_events += 1

    print(f"Africa positions (0,0): {africa_count}")
    print(f"Valid positions: {valid_count}")
    print(f"Start line candidate events: {start_line_events}")
    print(f"Follow Atlas toggles: {follow_atlas_toggles}")

if __name__ == "__main__":
    analyze_session(r"c:\JAVIER\VAKAROSLIVE\vakaroslive_session_2025-12-23T10-39-05.775Z.json")
