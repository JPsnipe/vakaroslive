import asyncio
from atlas2_mcp.server import Atlas2MCPServer
import time

async def test():
    print("Starting server test...")
    srv = Atlas2MCPServer()
    address = "CF:44:65:7D:2F:CE"
    
    print(f"Connecting to {address}...")
    await srv.ble.run(address_hint=address)
    
    print("Waiting for data (Auto-Push should trigger streaming)...", flush=True)
    samples = []
    for _ in range(30):
        await asyncio.sleep(1)
        d = srv.state.to_dict()
        samples.append(d)
        print(f"Sample: Hdg={d.get('heading_deg')}, COG={d.get('cog_deg')}, SOG={d.get('sog_knots')}, Pitch={d.get('pitch_deg')}, Heel={d.get('heel_deg')}", flush=True)
        if len([s for s in samples if s.get('heading_deg') is not None]) >= 5:
             break
    
    print("Disconnecting...")
    await srv.ble.stop()
    print("Done.")

if __name__ == "__main__":
    asyncio.run(test())
