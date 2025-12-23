import asyncio
import logging
import time
import pandas as pd
import matplotlib.pyplot as plt
from atlas2_mcp.server import Atlas2MCPServer

# Professional style
plt.style.use('seaborn-v0_8-muted')

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("trajectory_study")

TELEMETRY_DATA = []

async def main():
    address = "CF:44:65:7D:2F:CE"
    srv = Atlas2MCPServer()
    
    logger.info(f"Starting High-Frequency Trajectory Study for {address}...")
    task = asyncio.create_task(srv.ble.run(address_hint=address))
    
    # Wait for connection
    connected = False
    for _ in range(20):
        if srv.ble._current_client and srv.ble._current_client.is_connected:
            connected = True
            break
        await asyncio.sleep(1)
            
    if not connected:
        logger.error("Connection failed.")
        await srv.ble.stop()
        return

    logger.info("Connected. Capturing 15 seconds to visualize erratic trajectory...")
    
    start_time = time.time()
    while time.time() - start_time < 15:
        d = srv.state.to_dict()
        d["local_ts"] = time.time()
        TELEMETRY_DATA.append(d)
        await asyncio.sleep(0.1) # 10Hz sampling
    
    logger.info(f"Capture done. {len(TELEMETRY_DATA)} points.")
    await srv.ble.stop()
    try:
        await task
    except asyncio.CancelledError:
        pass

    if not TELEMETRY_DATA:
        logger.error("NO DATA.")
        return

    df = pd.DataFrame(TELEMETRY_DATA)
    df["t"] = (df["local_ts"] - df["local_ts"].iloc[0])
    
    df.to_csv("atlas_trajectory_export.csv", index=False)
    
    # 3-Panel Plot
    fig = plt.figure(figsize=(15, 12), dpi=120)
    gs = fig.add_gridspec(3, 2)
    
    # Subplot 1: COG comparison (Time Series)
    ax1 = fig.add_subplot(gs[0, :])
    ax1.plot(df["t"], df["cog_deg"], label="COG Fused (MCP)", color="indigo", linewidth=2)
    if "cog_test_deg" in df.columns:
        ax1.plot(df["t"], df["cog_test_deg"], label="COG Native (Atlas 2)", color="teal", linewidth=1.5, alpha=0.6, linestyle="--")
    ax1.set_title("COG Stability: Fused vs Native", fontsize=14, fontweight='bold')
    ax1.set_ylabel("Degrees (°)")
    ax1.legend()
    ax1.grid(True, alpha=0.3)

    # Subplot 2: SOG & Heading (Time Series)
    ax2 = fig.add_subplot(gs[1, :])
    ax2.plot(df["t"], df["heading_deg"], label="Heading", color="red", linewidth=1.5, alpha=0.9)
    ax2.set_ylabel("Hdg (°)")
    ax_twin = ax2.twinx()
    ax_twin.plot(df["t"], df["sog_knots"], label="SOG (GPS)", color="green", linewidth=1.2)
    ax_twin.set_ylabel("SOG (Knots)")
    ax2.set_title("Orientation vs GPS Variance", fontsize=12, fontweight='bold')
    ax2.grid(True, alpha=0.2)
    
    # Subplot 3: XY Trajectory (The "Erratic" behavior)
    ax3 = fig.add_subplot(gs[2, :])
    # Filtering outliers for better visualization if needed, but let's show the raw wander
    ax3.plot(df["longitude"], df["latitude"], color="black", alpha=0.3, linewidth=1)
    scatter = ax3.scatter(df["longitude"], df["latitude"], c=df["t"], cmap="viridis", s=10, label="Movement Wander")
    ax3.set_title("GPS Trajectory Wander (Indoor Noise)", fontsize=14, fontweight='bold')
    ax3.set_xlabel("Longitude")
    ax3.set_ylabel("Latitude")
    # Set equal aspect to avoid distortion
    ax3.set_aspect('auto')
    plt.colorbar(scatter, ax=ax3, label="Time (s)")

    plt.tight_layout()
    plt.savefig("erratic_trajectory_study.png")
    
    logger.info("Report saved: erratic_trajectory_study.png")
    print("DONE_TRAJECTORY_REPORT")

if __name__ == "__main__":
    asyncio.run(main())
