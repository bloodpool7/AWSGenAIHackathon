# Backend API for Frontend Chat

This backend connects your frontend chat to Claude AI (Bedrock) with MCP tools.

## Architecture

```
Frontend (React/Next.js)
    ↓ HTTP POST /api/chat
Backend API (Express)
    ↓ AWS Bedrock API
Claude AI
    ↓ MCP Protocol
Onshape MCP Server (local)
    ↓
Onshape API
```

## Setup

### 1. Install Dependencies

```bash
npm install @aws-sdk/client-bedrock-runtime
npm install express cors
npm install @types/express --save-dev
```

### 2. Build the MCP Server

```bash
npm run build
```

### 3. Set Environment Variables

```bash
export ONSHAPE_ACCESS_KEY="on_MbbD7rBrxSC06uYCPO3nL"
export ONSHAPE_SECRET_KEY="LHS5Xe942iNbWzPUcT435ZLvK8CcEeuj7JZWlVBMcO1ogcTM"
export AWS_ACCESS_KEY_ID="your_aws_key"
export AWS_SECRET_ACCESS_KEY="your_aws_secret"
export AWS_REGION="us-east-1"
```

### 4. Run the Backend

```bash
npx tsx backend-api.ts
```

Server runs on `http://localhost:3001`

## Frontend Integration

### API Endpoint

**POST** `http://localhost:3001/api/chat`

**Request:**
```json
{
  "message": "Create a cube STL file",
  "conversationHistory": [
    { "role": "user", "content": "previous message" },
    { "role": "assistant", "content": "previous response" }
  ]
}
```

**Response:**
```json
{
  "message": "I'll create a cube STL file for you...",
  "toolsUsed": ["import_stl"],
  "conversationHistory": [...]
}
```

### Example Frontend Code (React)

```tsx
const [messages, setMessages] = useState([]);
const [input, setInput] = useState('');

const sendMessage = async () => {
  const response = await fetch('http://localhost:3001/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: input,
      conversationHistory: messages
    })
  });

  const data = await response.json();
  setMessages(data.conversationHistory);
  setInput('');
};
```

## How It Works

1. **Frontend sends message** → Backend receives it
2. **Backend calls Claude (Bedrock)** with MCP tools available
3. **Claude decides to use MCP tools** (like `import_stl`)
4. **Backend calls MCP server** → Executes Onshape API
5. **MCP returns result** → Claude processes it
6. **Claude sends final response** → Backend returns to frontend

## Testing

```bash
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Create a simple cube STL file and import it to Onshape"}'
```

## AWS Deployment (After CDK Deploys)

Once the AWS infrastructure is ready, you can deploy this backend to:
- **Lambda** (serverless)
- **ECS** (containerized)
- **EC2** (traditional server)

The backend will connect to the AWS-deployed MCP server instead of local.
