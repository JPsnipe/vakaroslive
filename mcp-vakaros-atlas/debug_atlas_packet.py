import asyncio
import struct
import logging
from bleak import BleakClient

# Constants
VAKAROS_CHAR_TELEMETRY_MAIN = "ac510003-0000-5a11-0076-616b61726f73"
VAKAROS_CHAR_COMMAND_1 = "ac510002-0000-5a11-0076-616b61726f73"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("packet_debug")

async def analyze_packets(address):
    logger.info(f"Connecting to {address}...")
    
    async def on_main(sender, data):
        logger.info(f"MAIN RAW: {data.hex()}")
        # Search for coordinates in float32
        for off in range(len(data) - 4):
            val = struct.unpack_from("<f", data, off)[0]
            if 35.0 < abs(val) < 60.0: # Likely Latitude
                logger.info(f"  [float32] @{off}: {val:.6f}")
            if abs(val) < 10.0 and abs(val) > 0.1: # Likely Longitude (Spain)
                logger.info(f"  [float32] @{off}: {val:.6f}")

        # Search for coordinates in int32 scaled by 1e7
        for off in range(len(data) - 4):
            raw_val = struct.unpack_from("<i", data, off)[0]
            val = raw_val / 1e7
            if 35.0 < abs(val) < 60.0:
                logger.info(f"  [int32/1e7] @{off}: {val:.6f}")
            if abs(val) < 10.0 and abs(val) > 0.1:
                logger.info(f"  [int32/1e7] @{off}: {val:.6f}")

    try:
        async with BleakClient(address) as client:
            logger.info("Connected. Starting notifications...")
            # Trigger streaming
            await client.write_gatt_char(VAKAROS_CHAR_COMMAND_1, bytes([0x01]), response=True)
            await client.start_notify(VAKAROS_CHAR_TELEMETRY_MAIN, on_main)
            
            logger.info("Monitoring for 10 seconds...")
            await asyncio.sleep(10)
            await client.stop_notify(VAKAROS_CHAR_TELEMETRY_MAIN)
    except Exception as e:
        logger.error(f"Error: {e}")

if __name__ == "__main__":
    ADDRESS = "CF:44:65:7D:2F:CE"
    asyncio.run(analyze_packets(ADDRESS))
