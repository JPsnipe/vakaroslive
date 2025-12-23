import asyncio
import logging
import time
import math
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
from atlas2_mcp.server import Atlas2MCPServer

# AESTHETICS
plt.style.use('dark_background')
plt.rcParams['font.family'] = 'sans-serif'

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("COG_6DOF_Test")

# CONSTANTS
KNOTS_PER_MPS = 1.94384

def norm_deg(d):
    return (d + 360.0) % 360.0

def angle_diff(a, b):
    return ((a - b + 540.0) % 360.0) - 180.0

def blend_angle(a, b, weight_b):
    w = np.clip(weight_b, 0, 1)
    if w <= 0: return a
    if w >= 1: return b
    ar = np.radians(a)
    br = np.radians(b)
    x = (1 - w) * np.cos(ar) + w * np.cos(br)
    y = (1 - w) * np.sin(ar) + w * np.sin(br)
    if abs(x) < 1e-9 and abs(y) < 1e-9: return a
    return norm_deg(np.degrees(np.arctan2(y, x)))

def get_bearing(lat1, lon1, lat2, lon2):
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(lon2 - lon1)
    y = np.sin(dl) * np.cos(phi2)
    x = np.cos(phi1) * np.sin(phi2) - np.sin(phi1) * np.cos(phi2) * np.cos(dl)
    return norm_deg(np.degrees(np.arctan2(y, x)))

async def main():
    address = "CF:44:65:7D:2F:CE"
    srv = Atlas2MCPServer()
    
    logger.info(f"Connecting to {address} for refined capture...")
    task = asyncio.create_task(srv.ble.run(address_hint=address))
    
    connected = False
    for _ in range(15):
        if srv.ble._current_client and srv.ble._current_client.is_connected:
            connected = True
            break
        await asyncio.sleep(1)
            
    if not connected:
        logger.error("Connection failed.")
        await srv.ble.stop()
        return

    logger.info("CAPTURING 25s. Tip: Tilt the device and spin it slowly/fast.")
    
    raw_data = []
    start_time = time.time()
    while time.time() - start_time < 25:
        d = srv.state.to_dict()
        d["local_ts"] = time.time()
        raw_data.append(d)
        await asyncio.sleep(0.1)
    
    await srv.ble.stop()
    try: await task
    except asyncio.CancelledError: pass

    df = pd.DataFrame(raw_data)
    if df.empty: return

    # 1. PROCESS RATES
    df['dt'] = df['local_ts'].diff().fillna(0.1)
    # Correcting ROT for 360 wrap
    df['rot'] = (df['heading_deg'].diff().apply(lambda x: abs(((x + 180) % 360) - 180)) / df['dt']).fillna(0)
    df['roh'] = (df['heel_deg'].diff().abs() / df['dt']).fillna(0)
    df['rop'] = (df['pitch_deg'].diff().abs() / df['dt']).fillna(0)

    # 2. TRANSIENT DETECTION
    ROT_T = 12.0
    ROH_T = 8.0
    ROP_T = 6.0
    df['t_idx'] = np.maximum.reduce([df['rot'] / ROT_T, df['roh'] / ROH_T, df['rop'] / ROP_T])

    # 3. ADVANCED FUSION
    fused = []
    cur = None
    l_hdg = None
    
    for i, row in df.iterrows():
        hdg = row['heading_deg']
        sog = row['sog_knots'] or 0.0
        t_idx = row['t_idx']
        moving = sog > 0.5 # INDUSTRY STANDART: ignore GPS COG if static
        
        # Dead Reckoning Prediction
        if cur is not None and l_hdg is not None:
            pred = norm_deg(cur + angle_diff(hdg, l_hdg))
        else:
            pred = hdg
        
        l_hdg = hdg
        
        # GPS Bearing (2s window)
        gps_cog = None
        if i >= 20:
            past = df.iloc[i-20]
            gps_cog = get_bearing(past['latitude'], past['longitude'], row['latitude'], row['longitude'])

        # Adaptive Fusion Weight
        # Trust GPS only if moving and not maneuvering
        w_gps = 0.0
        if moving:
            w_gps = 0.3 # default
            if sog < 1.5: w_gps = 0.1
            if t_idx > 1.0: w_gps = 0.02 # Locked in turn
        
        if gps_cog is not None:
            cur = blend_angle(pred, gps_cog, w_gps)
        else:
            cur = pred
        
        fused.append(cur)

    df['fused_final'] = fused

    # 4. REPORT
    fig, axes = plt.subplots(4, 1, figsize=(14, 18), sharex=True, gridspec_kw={'height_ratios': [2, 1, 1, 2]})
    t = df['local_ts'] - df['local_ts'].iloc[0]
    
    axes[0].plot(t, df['heading_deg'], label="Heading", color='red', alpha=0.3)
    axes[0].plot(t, df['cog_test_deg'], label="Native Atlas 2 COG", color='cyan', alpha=0.4)
    axes[0].plot(t, df['fused_final'], label="Refined 6-DOF Fused COG", color='lime', linewidth=2.5)
    axes[0].set_title("Refined 6-DOF COG Fusion (with Static Rejection)", fontsize=16)
    axes[0].legend()
    axes[0].set_ylabel("Degrees (°)")

    axes[1].fill_between(t, 0, df['t_idx'], color='yellow', alpha=0.1)
    axes[1].plot(t, df['t_idx'], color='yellow', label="Transient Index (6-DOF)")
    axes[1].axhline(1.0, color='red', linestyle='--', label="Lock Threshold")
    axes[1].legend()
    axes[1].set_ylabel("Index")

    axes[2].plot(t, df['sog_knots'], label="SOG (knots)", color='white')
    axes[2].axhline(0.5, color='orange', linestyle=':', label="Moving Threshold")
    axes[2].legend()
    axes[2].set_ylabel("SOG")

    axes[3].plot(t, df['rot'], label="Rate of Turn", color='magenta', alpha=0.7)
    axes[3].plot(t, df['roh'], label="Rate of Heel", color='orange', alpha=0.7)
    axes[3].plot(t, df['rop'], label="Rate of Pitch", color='gray', alpha=0.7)
    axes[3].set_ylabel("Rates (°/s)")
    axes[3].set_xlabel("Time (s)")
    axes[3].legend()

    plt.tight_layout()
    plt.savefig("cog_6dof_refined_report.png")
    logger.info("Done. Check cog_6dof_refined_report.png")

if __name__ == "__main__":
    asyncio.run(main())
