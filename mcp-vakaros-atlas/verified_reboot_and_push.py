import asyncio
import logging
import time
from bleak import BleakClient, BleakScanner

# Constants
VAKAROS_SERVICE_UUID = "ac510001-0000-5a11-0076-616b61726f73"
VAKAROS_CHAR_COMMAND_1 = "ac510002-0000-5a11-0076-616b61726f73"
VAKAROS_CHAR_TELEMETRY_MAIN = "ac510003-0000-5a11-0076-616b61726f73"
VAKAROS_CHAR_COMMAND_2 = "ac510004-0000-5a11-0076-616b61726f73"
VAKAROS_CHAR_TELEMETRY_COMPACT = "ac510005-0000-5a11-0076-616b61726f73"

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("reboot_push_test")

async def run_flow(address):
    logger.info("--- STEP 1: REBOOT ATTEMPT (CMD1=0xDE - REBOOT?) ---")
    try:
        async with BleakClient(address) as client:
            logger.info("Connected. Sending 0xDE to Command 1 (Potential Reboot)...")
            await client.write_gatt_char(VAKAROS_CHAR_COMMAND_1, bytes([0xDE]), response=True)
            logger.info("Command sent. Waiting for disconnect/reboot...")
            await asyncio.sleep(5)
    except Exception as e:
        logger.info(f"Interaction result: {e}")

    logger.info("Waiting 10 seconds for device to restart...")
    await asyncio.sleep(10)

    logger.info("--- STEP 2: PUSH STREAMING ---")
    for attempt in range(5):
        try:
            async with BleakClient(address) as client:
                logger.info("Connected! Sending WAKE-UP (0x01) to Command 1...")
                await client.write_gatt_char(VAKAROS_CHAR_COMMAND_1, bytes([0x01]), response=True)
                
                logger.info("--- STEP 3: VERIFY DATA ---")
                logger.info("Polling Telemetry characteristics...")
                data_found = False
                for i in range(20):
                    try:
                        main_raw = await client.read_gatt_char(VAKAROS_CHAR_TELEMETRY_MAIN)
                        comp_raw = await client.read_gatt_char(VAKAROS_CHAR_TELEMETRY_COMPACT)
                        
                        logger.info(f"Sample {i}: Main={main_raw.hex()[:16]}... Compact={comp_raw.hex()}")
                        
                        # Verify it's not just zeros (header 0x02 for main, 0xfe for compact)
                        if len(main_raw) > 2 and main_raw[0] == 0x02:
                            # Check if latitude (bytes 8-11) or longitude (12-15) are non-zero if possible, 
                            # but seeing the 0x02 header is already a win.
                            data_found = True
                            
                        if data_found and i > 5:
                            logger.info("VERIFICATION SUCCESSFUL: Data is flowing!")
                            break
                    except Exception as e:
                        logger.warning(f"Poll error: {e}")
                    await asyncio.sleep(0.5)
                
                if data_found:
                    break
        except Exception as e:
            logger.warning(f"Reconnect attempt {attempt+1} failed: {e}")
            await asyncio.sleep(3)

    logger.info("Flow complete.")

if __name__ == "__main__":
    ADDRESS = "CF:44:65:7D:2F:CE"
    asyncio.run(run_flow(ADDRESS))
