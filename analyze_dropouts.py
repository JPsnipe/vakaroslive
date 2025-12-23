import json
import numpy as np
from datetime import datetime

def analyze_dropouts(path):
    with open(path, "r") as f:
        data = json.load(f)
    
    entries = data.get("entries", [])
    meta = data.get("meta", {})
    start_total = meta.get("started_ts_ms")
    stop_total = meta.get("stopped_ts_ms")
    
    rx_times = []
    for e in entries:
        if e.get("kind") == "ble_rx" and e.get("chan") == "main":
            rx_times.append(e["ts_ms"])
            
    if not rx_times:
        print("No data found.")
        return

    duration_total = (stop_total - start_total) / 1000.0
    print(f"Total Session Duration: {duration_total:.1f}s")
    print(f"Total Main Packets: {len(rx_times)}")
    
    ts = np.array(rx_times)
    diffs = np.diff(ts)
    
    print("\nMajor Dropouts (> 5 seconds):")
    big_gaps = np.where(diffs > 5000)[0]
    for i in big_gaps:
        gap_sec = diffs[i] / 1000.0
        time_since_start = (ts[i] - start_total) / 1000.0
        print(f"Dropped at offset {time_since_start:.1f}s (Time: {datetime.fromtimestamp(ts[i]/1000).strftime('%H:%M:%S')})")
        print(f"Restored {gap_sec:.1f}s later")

    # Check for frequent small drops
    small_gaps = diffs[(diffs > 250) & (diffs <= 5000)]
    if len(small_gaps) > 0:
        print(f"\nFrequent jitter Drops (>250ms): {len(small_gaps)} occurrences")
        print(f"Average jitter gap: {np.mean(small_gaps):.0f}ms")

if __name__ == "__main__":
    analyze_dropouts(r"c:\JAVIER\VAKAROSLIVE\vakaroslive_session_2025-12-23T10-39-05.775Z.json")
