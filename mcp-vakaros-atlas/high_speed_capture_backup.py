import asyncio
import time
import pandas as pd
import matplotlib.pyplot as plt
from atlas2_mcp.ble_manager import Atlas2BleManager
from atlas2_mcp.state import AtlasState

DEVICE_ADDRESS = "CF:44:65:7D:2F:CE"
CAPTURE_DURATION = 15.0 # Seconds

async def main():
    data_points = []
    state = AtlasState()

    def handle_event(event):
        state.apply_event(event)
        if event.get("type") in ("telemetry_main", "telemetry_compact"):
            # Sample current state
            data_points.append({
                "time": time.time(),
                "heading": state.heading_deg,
                "cog": state.cog_deg,
                "sog": state.sog_knots,
                "pitch": state.pitch_deg,
                "heel": state.heel_deg,
            })

    ble = Atlas2BleManager(event_callback=handle_event)
    
    print(f"Connecting to {DEVICE_ADDRESS} for {CAPTURE_DURATION}s capture...")
    
    # Start the BLE manager in the background
    run_task = asyncio.create_task(ble.run(address_hint=DEVICE_ADDRESS))
    
    # Wait for connection
    start_wait = time.time()
    while not state.connected and time.time() - start_wait < 10:
        await asyncio.sleep(0.5)
    
    if not state.connected:
        print("Failed to connect within 10s")
        run_task.cancel()
        return

    print("Connected! Capturing data...")
    start_capture = time.time()
    while time.time() - start_capture < CAPTURE_DURATION:
        await asyncio.sleep(0.1) # 10Hz approx wait, but data is event-driven
    
    print(f"Capture complete. Collected {len(data_points)} points.")
    
    # Stop BLE
    await ble.stop()
    await run_task
    
    if not data_points:
        print("No data collected.")
        return

    # Process and Plot
    df = pd.DataFrame(data_points)
    df["time"] = df["time"] - df["time"].iloc[0] # Relative time
    
    fig, axes = plt.subplots(4, 1, figsize=(10, 12), sharex=True)
    
    # Heading & COG
    axes[0].plot(df["time"], df["heading"], label="Heading", color="blue")
    axes[0].plot(df["time"], df["cog"], label="COG (Fused)", color="green", linestyle="--")
    axes[0].set_ylabel("Degrees")
    axes[0].legend()
    axes[0].set_title("Heading vs COG")
    
    # SOG
    axes[1].plot(df["time"], df["sog"], color="red")
    axes[1].set_ylabel("Knots")
    axes[1].set_title("Speed Over Ground (SOG)")
    
    # Pitch
    axes[2].plot(df["time"], df["pitch"], color="purple")
    axes[2].set_ylabel("Degrees")
    axes[2].set_title("Pitch (Cabeceo)")
    
    # Heel
    axes[3].plot(df["time"], df["heel"], color="orange")
    axes[3].set_ylabel("Degrees")
    axes[3].set_xlabel("Time (s)")
    axes[3].set_title("Heel (Escora)")
    
    plt.tight_layout()
    plot_path = "telemetry_capture.png"
    plt.savefig(plot_path)
    print(f"Plot saved to {plot_path}")

if __name__ == "__main__":
    asyncio.run(main())
