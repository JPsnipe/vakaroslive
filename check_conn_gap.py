import json

def check_connection_around_gap(path):
    with open(path, "r") as f:
        data = json.load(f)
    
    entries = data.get("entries", [])
    gap_start_ms = 1766486414875 
    gap_end_ms = gap_start_ms + 310120
    
    print(f"--- Around Gap Start ({gap_start_ms}) ---")
    count = 0
    for e in entries:
        ts = e.get("ts_ms", 0)
        if gap_start_ms - 500 <= ts <= gap_start_ms + 500:
            count += 1
            if count > 10: continue
            if e.get("kind") == "dashboard":
                conn = e.get("state", {}).get("connected")
                print(f"[{ts}] DASH: Connected={conn}")
            elif e.get("kind") == "ble_rx":
                print(f"[{ts}] RX: {e.get('chan')}")

    print(f"\n--- Around Gap End ({gap_end_ms}) ---")
    count = 0
    for e in entries:
        ts = e.get("ts_ms", 0)
        if gap_end_ms - 500 <= ts <= gap_end_ms + 500:
            count += 1
            if count > 10: continue
            if e.get("kind") == "dashboard":
                conn = e.get("state", {}).get("connected")
                print(f"[{ts}] DASH: Connected={conn}")
            elif e.get("kind") == "ble_rx":
                print(f"[{ts}] RX: {e.get('chan')}")

if __name__ == "__main__":
    check_connection_around_gap(r"c:\JAVIER\VAKAROSLIVE\vakaroslive_session_2025-12-23T10-39-05.775Z.json")
