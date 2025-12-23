import asyncio
import os
import time
from atlas2_mcp.ble_manager import Atlas2BleManager
from atlas2_mcp.state import AtlasState
from atlas2_mcp.protocol import parse_telemetry_main

# Simple ANSI colors
GREEN = "\033[92m"
BLUE = "\033[94m"
CYAN = "\033[96m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
END = "\033[0m"
CLEAR = "\033[H\033[J"

class VisualDashboard:
    def __init__(self):
        self.state = AtlasState()
        # Extra fields for visualization not in the basic state
        self.pitch = 0.0
        self.heel = 0.0
        self.last_raw = ""
        
    def handle_event(self, event):
        self.state.apply_event(event)
        if event.get("type") == "telemetry_main":
            self.pitch = event.get("field_4", 0.0)
            self.heel = event.get("field_5", 0.0)
            self.last_raw = event.get("raw_hex", "")

    def draw(self):
        print(CLEAR)
        print(f"{BOLD}{BLUE}========================================={END}")
        print(f"{BOLD}{BLUE}       ATLAS 2 REAL-TIME DASHBOARD       {END}")
        print(f"{BOLD}{BLUE}========================================={END}")
        
        status_color = GREEN if self.state.connected else RED
        status_text = "CONNECTED" if self.state.connected else "SEARCHING..."
        print(f"Status: {status_color}{BOLD}{status_text}{END} | Device: {CYAN}{self.state.device_address or 'N/A'}{END}")
        print(f"Time: {YELLOW}{time.strftime('%H:%M:%S')}{END}")
        print(f"{BLUE}-----------------------------------------{END}")
        
        # Telemetry
        hdg = self.state.heading_deg if self.state.heading_deg is not None else 0.0
        sog = self.state.sog_knots if self.state.sog_knots is not None else 0.0
        
        print(f"{BOLD}HEADING:{END}  {CYAN}{hdg:6.1f}°{END}")
        print(f"{BOLD}PITCH:  {END}  {YELLOW}{self.pitch:6.1f}°{END}")
        print(f"{BOLD}HEEL:   {END}  {YELLOW}{self.heel:6.1f}°{END}")
        
        print(f"{BLUE}-----------------------------------------{END}")
        print(f"{BOLD}SOG:    {END}  {GREEN}{sog:6.2f} kn{END} (No GPS)")
        print(f"{BOLD}POS:    {END}  Lat: {self.state.latitude or 0.0:.5f}, Lon: {self.state.longitude or 0.0:.5f}")
        
        print(f"{BLUE}-----------------------------------------{END}")
        if self.last_raw:
            print(f"{BOLD}Last Packet (Hex):{END}")
            # Show first 32 chars of hex
            print(f"{self.last_raw[:48]}...")
        
        print(f"\n{YELLOW}Press Ctrl+C to exit{END}")

async def main():
    dash = VisualDashboard()
    ble = Atlas2BleManager(event_callback=dash.handle_event)
    
    # Target address from images
    address = "CF:44:65:7D:2F:CE"
    
    # Start BLE in background
    run_task = asyncio.create_task(ble.run(address_hint=address))
    
    try:
        while True:
            dash.draw()
            await asyncio.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        await ble.stop()
        await run_task

if __name__ == "__main__":
    # Ensure ANSI support on Windows
    if os.name == 'nt':
        os.system('')
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nExiting...")
