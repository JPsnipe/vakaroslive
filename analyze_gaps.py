import json
import numpy as np

def analyze_gaps(path):
    with open(path, "r") as f:
        data = json.load(f)
    
    entries = data.get("entries", [])
    timestamps = []
    
    for e in entries:
        if e.get("kind") == "ble_rx" and e.get("chan") == "main":
            timestamps.append(e["ts_ms"])
            
    if not timestamps:
        print("No ble_rx entries found.")
        return

    ts = np.array(timestamps)
    diffs = np.diff(ts)
    
    # Normal interval should be around 100ms (10Hz)
    gaps = diffs[diffs > 300] # Gaps larger than 300ms
    
    print(f"Total entries: {len(ts)}")
    print(f"Total gaps > 300ms: {len(gaps)}")
    if len(gaps) > 0:
        print(f"Max gap: {np.max(gaps)/1000:.2f}s")
        print(f"Mean gap size when it cuts: {np.mean(gaps)/1000:.2f}s")
        print(f"Total time lost in gaps: {np.sum(gaps)/1000:.1f}s")
        
    print("\nGap details (first 10):")
    gap_indices = np.where(diffs > 300)[0]
    for i in gap_indices[:10]:
        gap_sec = diffs[i] / 1000.0
        # rough time from start
        time_offset = (ts[i] - ts[0]) / 1000.0
        print(f"At {time_offset:.1f}s: Gap of {gap_sec:.2f}s")

if __name__ == "__main__":
    analyze_gaps(r"c:\JAVIER\VAKAROSLIVE\vakaroslive_session_2025-12-23T10-39-05.775Z.json")
