import asyncio
import logging
from atlas2_mcp.ble_manager import Atlas2BleManager
from atlas2_mcp.state import AtlasState

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("test_atlas")

async def test_scan():
    state = AtlasState()
    ble = Atlas2BleManager(event_callback=state.apply_event, logger=logger)
    
    print("Scanning for all BLE devices...")
    from bleak import BleakScanner
    print("Scanning for all BLE devices...")
    from bleak import BleakScanner
    def callback(device, advertisement_data):
        rssi = advertisement_data.rssi if hasattr(advertisement_data, "rssi") else "N/A"
        name = device.name or "None"
        print(f"ADVERTISEMENT: {name} ({device.address}) | RSSI: {rssi} | UUIDs: {advertisement_data.service_uuids} | Manufacturer: {advertisement_data.manufacturer_data}")

    scanner = BleakScanner(callback)
    await scanner.start()
    await asyncio.sleep(10.0)
    await scanner.stop()
    
    # Get the devices from the internal state of the scanner if needed, 
    # but the callback will print the info we need.
    print("\nScan complete.")
    
    print("\nFiltering for Atlas 2...")
    # Use the address from the user's images
    address = "CF:44:65:7D:2F:CE"
    print(f"Using known address from images: {address}")
    
    if address:
        print(f"Connecting to {address}...")
        
        # Start the background run
        run_task = asyncio.create_task(ble.run(address_hint=address))
        
        # Give it a moment to connect
        await asyncio.sleep(5)
        
        if ble._current_client and ble._current_client.is_connected:
            print("\nConnected! Listing services and characteristics:")
            for service in ble._current_client.services:
                print(f"Service: {service.uuid}")
                for char in service.characteristics:
                    print(f"  - Char: {char.uuid} | Properties: {char.properties}")
        
        # Wait for some data
        for _ in range(15):
            await asyncio.sleep(1)
            print(f"Status: {'Connected' if state.connected else 'Connecting...'} | Hdg: {state.heading_deg} | SOG: {state.sog_knots}")
            if state.heading_deg is not None:
                print("Data received successfully!")
                break
        
        await ble.stop()
        await run_task
    else:
        print("No Atlas 2 found. Make sure it is on and streaming.")

if __name__ == "__main__":
    asyncio.run(test_scan())
