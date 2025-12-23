import asyncio
import logging
import time
from bleak import BleakClient

# Constants
VAKAROS_SERVICE_UUID = "ac510001-0000-5a11-0076-616b61726f73"
VAKAROS_CHAR_COMMAND_1 = "ac510002-0000-5a11-0076-616b61726f73"
VAKAROS_CHAR_TELEMETRY_MAIN = "ac510003-0000-5a11-0076-616b61726f73"
VAKAROS_CHAR_COMMAND_2 = "ac510004-0000-5a11-0076-616b61726f73"
VAKAROS_CHAR_TELEMETRY_COMPACT = "ac510005-0000-5a11-0076-616b61726f73"

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("trigger_test")

async def test_trigger(address):
    logger.info(f"Targeting device: {address}")
    
    def notification_handler(sender, data):
        logger.info(f"NOTIFICATION from {sender}: {data.hex()}")

    try:
        async with BleakClient(address) as client:
            logger.info(f"Connected to {address}")
            
            # Start notifications
            logger.info("Starting notifications for Main Telemetry...")
            await client.start_notify(VAKAROS_CHAR_TELEMETRY_MAIN, notification_handler)
            
            logger.info("Starting notifications for Compact Telemetry...")
            await client.start_notify(VAKAROS_CHAR_TELEMETRY_COMPACT, notification_handler)
            
            logger.info("Waiting 3 seconds to check if it's already streaming...")
            await asyncio.sleep(3)
            
            # READ ALL FIRST
            logger.info("Reading all available characteristics for initial state...")
            for service in client.services:
                for char in service.characteristics:
                    if "read" in char.properties:
                        try:
                            val = await client.read_gatt_char(char.uuid)
                            logger.info(f"READ {char.uuid}: {val.hex()}")
                        except Exception:
                            pass

            # SEND TRIGGER 1
            logger.info("Sending WAKE-UP command (0x01) to Command 1...")
            await client.write_gatt_char(VAKAROS_CHAR_COMMAND_1, bytes([0x01]), response=True)
            await asyncio.sleep(2)
            
            # READ AGAIN
            logger.info("Reading all characteristics after 0x01...")
            for service in client.services:
                for char in service.characteristics:
                    if "read" in char.properties:
                        try:
                            val = await client.read_gatt_char(char.uuid)
                            logger.info(f"POST-0x01 {char.uuid}: {val.hex()}")
                        except Exception:
                            pass

            # SEND TRIGGER 2 (Alternative)
            logger.info("Sending Alternative TRIGGER (0x02) to Command 1...")
            await client.write_gatt_char(VAKAROS_CHAR_COMMAND_1, bytes([0x02]), response=True)
            await asyncio.sleep(2)

            # TRY COMMAND 2
            logger.info("Sending 0x01 to Command 2...")
            await client.write_gatt_char(VAKAROS_CHAR_COMMAND_2, bytes([0x01]), response=True)
            
            # DUMP ALL
            logger.info("Final characterization dump...")
            for service in client.services:
                logger.info(f"Service: {service.uuid}")
                for char in service.characteristics:
                    props = ",".join(char.properties)
                    val = "N/A"
                    if "read" in char.properties:
                        try:
                            v = await client.read_gatt_char(char.uuid)
                            val = v.hex()
                        except: pass
                    logger.info(f"  Char: {char.uuid} | Props: {props} | Value: {val}")

            # POLLING LOOP
            logger.info("Starting POLLING loop for 10 seconds (5Hz)...")
            for i in range(50):
                try:
                    m = await client.read_gatt_char(VAKAROS_CHAR_TELEMETRY_MAIN)
                    c = await client.read_gatt_char(VAKAROS_CHAR_TELEMETRY_COMPACT)
                    if i % 5 == 0:
                        logger.info(f"POLL {i//5}: Main={m.hex()[:20]}... Compact={c.hex()}")
                except Exception as e:
                    logger.warning(f"Poll error: {e}")
                await asyncio.sleep(0.2)

            await client.stop_notify(VAKAROS_CHAR_TELEMETRY_MAIN)
            await client.stop_notify(VAKAROS_CHAR_TELEMETRY_COMPACT)
            
    except Exception as e:
        logger.error(f"Error during test: {e}")

if __name__ == "__main__":
    ADDRESS = "CF:44:65:7D:2F:CE"
    asyncio.run(test_trigger(ADDRESS))
