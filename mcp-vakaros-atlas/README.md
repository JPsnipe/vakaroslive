# Atlas 2 MCP Server

Standalone Model Context Protocol (MCP) server for Vakaros Atlas 2 instrumentation.

## Setup
1. **Isolated Directory**: All code is inside `mcp-vakaros-atlas`.
2. **Install Dependencies**:
   ```bash
   cd mcp-vakaros-atlas
   pip install -r requirements.txt
   ```

## Antigravity Configuration
To use this server in Antigravity, add it to your `mcp_config.json` (usually in `%APPDATA%\antigravity\config\mcp_config.json`):

```json
{
  "mcpServers": {
    "atlas2": {
      "command": "python",
      "args": [
        "-m",
        "atlas2_mcp.server"
      ],
      "cwd": "c:/JAVIER/VAKAROSLIVE/mcp-vakaros-atlas",
      "env": {
        "PYTHONPATH": "c:/JAVIER/VAKAROSLIVE/mcp-vakaros-atlas"
      }
    }
  }
}
```

## Tools & Resources
Once configured, the following will be available to Antigravity agents:

### Tools
- `scan_devices`: Returns available Atlas 2 devices.
- `connect_device(address)`: Connects to the specified address (e.g., `CF:44:65:7D:2F:CE`).
- `get_telemetry`: Returns the latest Heading, Pitch, Heel, and Speed.

### Resources
- `atlas://state/current`: View the raw internal state.
- `atlas://telemetry/current`: Concise view of key metrics.

## Real-time Testing
Run the visual dashboard for a quick check:
```bash
python visual_dashboard.py
```
