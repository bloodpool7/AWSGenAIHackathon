# VibeCAD 🚀

A Model Context Protocol (MCP) server that enables AI assistants to create and import STL files directly into Onshape CAD.

## Architecture

```
Frontend Application
    ↓
Backend API (Express)
    ↓
AWS Bedrock (Claude AI)
    ↓
MCP Server (SSE Transport)
    ↓
Onshape API
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Project

```bash
npm run build
```

### 3. Set Environment Variables

```bash
export ONSHAPE_ACCESS_KEY="your_access_key"
export ONSHAPE_SECRET_KEY="your_secret_key"
export ONSHAPE_API_URL="https://cad.onshape.com/api/v12"
```

### 4. Run Locally

#### Test MCP Server (SSE Transport)
```bash
node dist/server.js
```

Server will start on `http://localhost:3000`

Endpoints:
- `GET /sse` - SSE connection for MCP protocol
- `POST /messages` - Message handler
- `GET /health` - Health check

#### Test with Claude Desktop (Stdio Transport)
```bash
node dist/server-stdio.js
```

Or configure in `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "onshape_mcp": {
      "command": "node",
      "args": ["/path/to/bruinaihack/dist/server-stdio.js"],
      "env": {
        "ONSHAPE_ACCESS_KEY": "your_key",
        "ONSHAPE_SECRET_KEY": "your_secret"
      }
    }
  }
}
```

## Deployment to AWS

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions including:
- AWS Bedrock AgentCore setup
- Lambda/ECS/EC2 deployment options
- Frontend integration examples
- Security best practices

### Quick Deploy with Docker

```bash
# Build
docker build -t onshape-mcp-server .

# Run locally
docker run -p 3000:3000 \
  -e ONSHAPE_ACCESS_KEY="your_key" \
  -e ONSHAPE_SECRET_KEY="your_secret" \
  onshape-mcp-server

# Test
curl http://localhost:3000/health
```

## Frontend Integration

1. **Start your backend API** (see `example-backend.ts`)
2. **Open the frontend** (`example-frontend.html`)
3. **Configure the backend URL** in the UI
4. **Start chatting** with the AI to create CAD models!

Example prompt:
> "Create a cube STL file and import it into Onshape"

## Available Tools

### `import_stl`

Creates an Onshape document from an ASCII STL string.

**Parameters:**
- `stl` (required): ASCII STL content
- `documentName` (optional): Name for the document (default: "AI Model [ISO date]")
- `filename` (optional): Filename for the STL (default: "model.stl")
- `createNewPartStudio` (optional): Create a new Part Studio (default: false)

**Example Response:**
```
🎉 Imported STL into Onshape!
Document: My Cube Model
ID: abc123...
View: https://cad.onshape.com/documents/abc123...
```

## Development

```bash
# Watch mode
npm run watch

# Build
npm run build
```

## Project Structure

```
bruinaihack/
├── src/
│   ├── server.ts           # SSE server (for Bedrock AgentCore)
│   └── server-stdio.ts     # Stdio server (for Claude Desktop)
├── dist/                   # Compiled JavaScript
├── example-frontend.html   # Example web UI
├── example-backend.ts      # Example backend API
├── Dockerfile             # Docker configuration
├── DEPLOYMENT.md          # Deployment guide
└── package.json
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ONSHAPE_ACCESS_KEY` | Onshape API access key | Yes |
| `ONSHAPE_SECRET_KEY` | Onshape API secret key | Yes |
| `ONSHAPE_API_URL` | Onshape API base URL | No (defaults to v12) |
| `PORT` | Server port | No (defaults to 3000) |
| `AWS_ACCESS_KEY_ID` | AWS credentials (for backend) | Yes (for backend) |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials (for backend) | Yes (for backend) |
| `BEDROCK_AGENT_ID` | Bedrock agent ID (for backend) | Yes (for backend) |
| `BEDROCK_ALIAS_ID` | Bedrock alias ID (for backend) | Yes (for backend) |

## Troubleshooting

### "Port 3000 already in use"
```bash
lsof -ti:3000 | xargs kill -9
# Or use a different port
PORT=3001 node dist/server.js
```

### "Server disconnected" in Claude Desktop
- Make sure you're using `server-stdio.js` (not `server.js`)
- Check environment variables are set correctly
- Restart Claude Desktop after config changes

### Onshape API errors
- Verify your API keys at https://dev-portal.onshape.com
- Check API key permissions
- Monitor rate limits

## License

MIT

## Contributing

Pull requests are welcome! For major changes, please open an issue first.
