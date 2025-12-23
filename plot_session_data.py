import json
import matplotlib.pyplot as plt
import numpy as np
import math
from datetime import datetime
import matplotlib.dates as mdates

def calculate_bearing(lat1, lon1, lat2, lon2):
    """Calculates bearing between two points in degrees."""
    if None in [lat1, lon1, lat2, lon2]: return None
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_lambda = math.radians(lon2 - lon1)
    y = math.sin(d_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(d_lambda)
    bearing = math.degrees(math.atan2(y, x))
    return (bearing + 360) % 360

def plot_session(path):
    with open(path, "r") as f:
        data = json.load(f)
    
    entries = data.get("entries", [])
    t_dt = []
    lat = []
    lon = []
    hdg = []
    pitch = []
    heel = []
    sog_kn = []
    cog_device = []
    cog_derived = []

    last_lat, last_lon = None, None

    for e in entries:
        if e.get("kind") == "ble_parsed" and e.get("chan") == "main":
            parsed = e.get("parsed", {})
            ts_ms = parsed.get("ts_ms")
            if ts_ms is None: continue
            
            t_dt.append(datetime.fromtimestamp(ts_ms / 1000.0))
            
            curr_lat = parsed.get("latitude")
            curr_lon = parsed.get("longitude")
            lat.append(curr_lat)
            lon.append(curr_lon)
            hdg.append(parsed.get("heading_deg"))
            pitch.append(parsed.get("field_4")) 
            heel.append(parsed.get("field_5"))  
            
            f6 = parsed.get("field_6")
            if f6 is not None:
                sog_kn.append(f6 * 1.94384) 
            else:
                sog_kn.append(None)
                
            cog_device.append(parsed.get("cog_test_deg"))

            # Calculate Derived COG
            if last_lat is not None and curr_lat is not None:
                # Use a small distance threshold to avoid noise at rest
                dlat = curr_lat - last_lat
                dlon = curr_lon - last_lon
                if abs(dlat) > 1e-7 or abs(dlon) > 1e-7:
                    cog_derived.append(calculate_bearing(last_lat, last_lon, curr_lat, curr_lon))
                else:
                    cog_derived.append(cog_derived[-1] if cog_derived else None)
            else:
                cog_derived.append(None)
            
            last_lat, last_lon = curr_lat, curr_lon

    def clean(arr):
        return [x if x is not None else np.nan for x in arr]

    lat = clean(lat)
    hdg = clean(hdg)
    pitch = clean(pitch)
    heel = clean(heel)
    sog_kn = clean(sog_kn)
    cog_device = clean(cog_device)
    cog_derived = clean(cog_derived)

    plt.style.use('dark_background')
    fig, axes = plt.subplots(6, 1, figsize=(14, 22), sharex=True)
    plt.subplots_adjust(hspace=0.4)
    
    bg_color = "#0b1220"
    fig.patch.set_facecolor(bg_color)
    
    start_time = t_dt[0].strftime('%H:%M:%S')
    end_time = t_dt[-1].strftime('%H:%M:%S')
    duration_sec = (t_dt[-1] - t_dt[0]).total_seconds()

    for ax in axes:
        ax.set_facecolor(bg_color)
        ax.grid(True, alpha=0.1, linestyle='--')
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
        ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=10, maxticks=20))

    # Title with info
    axes[0].set_title(f"Vakaros Atlas 2 - Stability & COG Study\nStart: {start_time} | Duration: {duration_sec:.1f}s", 
                      color="white", fontsize=16, pad=25)

    # Subplot 1: Heading
    axes[0].plot(t_dt, hdg, color="#4ea1ff", linewidth=1.5, label="Magnetic Heading")
    axes[0].set_ylabel("Degrees", color="#4ea1ff")
    axes[0].legend(loc="upper right", frameon=False)

    # Subplot 2: SOG
    axes[1].fill_between(t_dt, 0, sog_kn, color="#ff5d5d", alpha=0.1)
    axes[1].plot(t_dt, sog_kn, color="#ff5d5d", linewidth=1.5, label="SOG (knots)")
    axes[1].set_ylabel("Knots", color="#ff5d5d")
    axes[1].legend(loc="upper right", frameon=False)

    # Subplot 3: Pitch
    axes[2].plot(t_dt, pitch, color="#c084fc", linewidth=1.5, label="Pitch (Attitude)")
    axes[2].set_ylabel("Degrees", color="#c084fc")
    axes[2].legend(loc="upper right", frameon=False)

    # Subplot 4: Heel
    axes[3].plot(t_dt, heel, color="#ffa94d", linewidth=1.5, label="Heel (Attitude)")
    axes[3].set_ylabel("Degrees", color="#ffa94d")
    axes[3].legend(loc="upper right", frameon=False)

    # Subplot 5: Position Stability
    lat_arr = np.array(lat)
    valid_mask = ~np.isnan(lat_arr)
    if np.any(valid_mask):
        mean_lat = np.nanmean(lat_arr)
        lat_diff_m = (lat_arr - mean_lat) * 111111
        axes[4].plot(t_dt, lat_diff_m, color="#4dffb5", linewidth=1, label="GPS Lat Latency Noise (meters)")
        axes[4].set_ylabel("Meters", color="#4dffb5")
        axes[4].legend(loc="upper right", frameon=False)

    # Subplot 6: COG Comparison (The core of the request)
    axes[5].plot(t_dt, cog_device, color="#ffcc66", linewidth=1.2, alpha=0.6, label="Device Reported COG")
    axes[5].plot(t_dt, cog_derived, color="#ffffff", linewidth=1.5, label="Derived COG (Calculated from Lat/Lon)")
    axes[5].set_ylabel("Degrees", color="#ffcc66")
    axes[5].set_xlabel("Local Time (HH:MM:SS)", color="white")
    axes[5].legend(loc="upper right", frameon=False)

    plt.gcf().autofmt_xdate()
    
    output_path = "logs/session_analysis_fancy.png"
    plt.savefig(output_path, dpi=200, bbox_inches='tight', facecolor=fig.get_facecolor())
    print(f"Plot saved to {output_path}")

if __name__ == "__main__":
    plot_session(r"c:\JAVIER\VAKAROSLIVE\vakaroslive_session_2025-12-23T10-39-05.775Z.json")
