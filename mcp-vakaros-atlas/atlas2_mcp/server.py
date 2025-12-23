from __future__ import annotations

import asyncio
import logging
import sys
from typing import Any

from mcp.server.models import InitializationOptions
from mcp.server import NotificationOptions, Server
from mcp.server.stdio import stdio_server
import mcp.types as types

from .state import AtlasState
from .ble_manager import Atlas2BleManager

# Configure logging - MUST go to stderr for MCP
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    stream=sys.stderr
)
logger = logging.getLogger("atlas2_mcp")

class Atlas2MCPServer:
    def __init__(self):
        self.state = AtlasState()
        # Wrapper to handle async events from the BLE manager in a thread-safe way
        def event_wrapper(event):
            asyncio.create_task(self.handle_event(event))
        self.ble = Atlas2BleManager(event_callback=event_wrapper, logger=logger)
        self.server = Server("atlas2-mcp")
        self._setup_handlers()

    async def handle_event(self, event: dict[str, Any]):
        self.state.apply_event(event)
        # Notify clients that telemetry has updated
        if event.get("type") in ("telemetry_main", "telemetry_compact"):
            try:
                # notification_context is only available after session starts
                if hasattr(self.server, "notification_context") and self.server.notification_context:
                    await self.server.notification_context.session.send_resource_updated_notification(
                        uri="atlas://telemetry/current"
                    )
                    await self.server.notification_context.session.send_resource_updated_notification(
                        uri="atlas://state/current"
                    )
            except Exception as e:
                # Log but dont crash if no session is active (e.g. during script tests)
                logger.debug(f"Notification error: {e}")

    def _setup_handlers(self):
        @self.server.list_resources()
        async def handle_list_resources() -> list[types.Resource]:
            return [
                types.Resource(
                    uri="atlas://state/current",
                    name="Current Atlas 2 State",
                    description="The complete current state of the connected Atlas 2 device",
                    mimeType="application/json",
                ),
                types.Resource(
                    uri="atlas://telemetry/current",
                    name="Current Telemetry",
                    description="Essential telemetry data (heading, speed, position)",
                    mimeType="application/json",
                ),
            ]

        @self.server.read_resource()
        async def handle_read_resource(uri: str) -> str:
            import json
            if uri == "atlas://state/current":
                return json.dumps(self.state.to_dict(), indent=2)
            elif uri == "atlas://telemetry/current":
                # "No cribas" - return everything in the telemetry resource too
                return json.dumps(self.state.to_dict(), indent=2)
            raise ValueError(f"Unknown resource: {uri}")

        @self.server.list_tools()
        async def handle_list_tools() -> list[types.Tool]:
            return [
                types.Tool(
                    name="scan_devices",
                    description="Scan for available Atlas 2 devices",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "timeout": {"type": "number", "default": 5.0}
                        }
                    },
                ),
                types.Tool(
                    name="connect_device",
                    description="Connect to an Atlas 2 device by its address",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "address": {"type": "string"}
                        },
                        "required": ["address"]
                    },
                ),
                types.Tool(
                    name="get_telemetry",
                    description="Get the latest telemetry from the connected device",
                    inputSchema={"type": "object", "properties": {}},
                ),
                types.Tool(
                    name="disconnect_device",
                    description="Disconnect from the Atlas 2 device and release the Bluetooth connection",
                    inputSchema={"type": "object", "properties": {}},
                ),
                types.Tool(
                    name="send_raw_command",
                    description="Send a raw hex command to a specific characteristic",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "payload_hex": {"type": "string", "description": "Hexadecimal payload, e.g. '0102'"},
                            "char_uuid": {"type": "string", "description": "Optional characteristic UUID"}
                        },
                        "required": ["payload_hex"]
                    },
                ),
                types.Tool(
                    name="reboot_device",
                    description="Attempt to reboot the Atlas 2 device",
                    inputSchema={"type": "object", "properties": {}},
                ),
                types.Tool(
                    name="force_streaming",
                    description="Force the Atlas 2 to start streaming telemetry (Push)",
                    inputSchema={"type": "object", "properties": {}},
                ),
                types.Tool(
                    name="capture_and_plot",
                    description="Capture 15 seconds of telemetry at 10Hz and generate temporal graphs",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "duration": {"type": "number", "default": 15.0}
                        }
                    },
                ),
            ]

        @self.server.call_tool()
        async def handle_call_tool(name: str, arguments: dict | None) -> list[types.TextContent | types.ImageContent | types.EmbeddedResource]:
            try:
                if name == "scan_devices":
                    timeout = arguments.get("timeout", 5.0) if arguments else 5.0
                    devices = await self.ble.scan(timeout=timeout)
                    import json
                    return [types.TextContent(type="text", text=json.dumps(devices, indent=2))]
                
                elif name == "connect_device":
                    address = arguments.get("address")
                    # Start communication in a background task
                    asyncio.create_task(self.ble.run(address_hint=address))
                    return [types.TextContent(type="text", text=f"Connection attempt started for {address}")]
                
                elif name == "get_telemetry":
                    import json
                    return [types.TextContent(type="text", text=json.dumps(self.state.to_dict(), indent=2))]

                elif name == "disconnect_device":
                    await self.ble.stop()
                    return [types.TextContent(type="text", text="Disconnected and BLE connection released.")]
                
                elif name == "send_raw_command":
                    hex_payload = arguments.get("payload_hex")
                    char_uuid = arguments.get("char_uuid", "ac510002-0000-5a11-0076-616b61726f73") # Command 1
                    if not hex_payload:
                        return [types.TextContent(type="text", text="Error: Missing payload_hex")]
                    
                    payload = bytes.fromhex(hex_payload)
                    success = await self.ble.write_command(payload, char_uuid)
                    return [types.TextContent(type="text", text=f"Command sent: {success}")]

                elif name == "reboot_device":
                    # Rebooting seems complex, but let's try a known Vakaros reboot byte 0xDE
                    payload = bytes([0xDE]) 
                    success = await self.ble.write_command(payload, "ac510002-0000-5a11-0076-616b61726f73")
                    return [types.TextContent(type="text", text=f"Reboot command attempt(0xDE) sent: {success}")]

                elif name == "force_streaming":
                    payload = bytes([0x01])
                    success = await self.ble.write_command(payload)
                    return [types.TextContent(type="text", text=f"Streaming trigger sent (0x01): {success}")]

                elif name == "capture_and_plot":
                    duration = arguments.get("duration", 15.0) if arguments else 15.0
                    samples = []
                    start_time = asyncio.get_event_loop().time()
                    
                    # Capture loop
                    while (asyncio.get_event_loop().time() - start_time) < duration:
                        samples.append({
                            "t": asyncio.get_event_loop().time() - start_time,
                            **self.state.to_dict()
                        })
                        await asyncio.sleep(0.1) # 10Hz sample rate
                    
                    # Generate Plot
                    import pandas as pd
                    import matplotlib.pyplot as plt
                    import os
                    
                    df = pd.DataFrame(samples)
                    fig, axes = plt.subplots(4, 1, figsize=(10, 12), sharex=True)
                    
                    axes[0].plot(df["t"], df["heading_deg"], label="Heading", color="blue")
                    axes[0].plot(df["t"], df["cog_deg"], label="COG", color="green", linestyle="--")
                    axes[0].set_ylabel("Degrees")
                    axes[0].legend()
                    axes[0].set_title("Heading vs COG")
                    
                    axes[1].plot(df["t"], df["sog_knots"], color="red")
                    axes[1].set_ylabel("Knots")
                    axes[1].set_title("SOG")
                    
                    axes[2].plot(df["t"], df["pitch_deg"], color="purple")
                    axes[2].set_ylabel("Degrees")
                    axes[2].set_title("Pitch")
                    
                    axes[3].plot(df["t"], df["heel_deg"], color="orange")
                    axes[3].set_ylabel("Degrees")
                    axes[3].set_xlabel("Time (s)")
                    axes[3].set_title("Heel")
                    
                    plt.tight_layout()
                    plot_filename = "telemetry_capture.png"
                    plt.savefig(plot_filename)
                    plt.close(fig)
                    
                    abs_path = os.path.abspath(plot_filename)
                    return [types.TextContent(type="text", text=f"Captured {len(samples)} samples. Plot saved to: {abs_path}")]

                raise ValueError(f"Unknown tool: {name}")
            except Exception as e:
                return [types.TextContent(type="text", text=f"Error: {str(e)}")]

    async def run(self):
        async with stdio_server() as (read_stream, write_stream):
            await self.server.run(
                read_stream,
                write_stream,
                InitializationOptions(
                    server_name="atlas2-mcp",
                    server_version="0.1.0",
                    capabilities=self.server.get_capabilities(
                        notification_options=NotificationOptions(),
                        experimental_capabilities={},
                    ),
                ),
            )

async def main():
    server = Atlas2MCPServer()
    await server.run()

if __name__ == "__main__":
    asyncio.run(main())
