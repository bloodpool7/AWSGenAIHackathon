import express from 'express';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';


const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Initialize Bedrock client
const bedrock = new BedrockRuntimeClient({ region: 'us-east-2' });

// MCP Client setup
let mcpClient: Client | null = null;
let availableTools: any[] = [];

async function initMCP() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/server-stdio.js'],
    env: {
      ...process.env,
      ONSHAPE_ACCESS_KEY: process.env.ONSHAPE_ACCESS_KEY!,
      ONSHAPE_SECRET_KEY: process.env.ONSHAPE_SECRET_KEY!,
    }
  });

  mcpClient = new Client({
    name: 'backend-api-client',
    version: '1.0.0',
  }, {
    capabilities: {}
  });

  await mcpClient.connect(transport);

  // Get available tools using the proper SDK method
  const toolsResult = await mcpClient.listTools();
  availableTools = toolsResult.tools.map((tool: any) => ({
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: {
        json: tool.inputSchema
      }
    }
  }));

  console.log('MCP Client initialized with tools:', availableTools.map(t => t.toolSpec.name));
}

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!mcpClient) {
      await initMCP();
    }

    // Format conversation history for Claude
    const messages = [
      ...conversationHistory.map((msg: any) => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? [{ text: msg.content }] : msg.content
      })),
      { role: 'user', content: [{ text: message }] }
    ];

    let response;
    let toolResults: any[] = [];
    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      // Call Claude with available tools
      // Using Claude Sonnet 4.5 via cross-region inference profile
      const command = new ConverseCommand({
        modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        messages,
        toolConfig: {
          tools: availableTools
        }
      });

      response = await bedrock.send(command);

      // Check if Claude wants to use a tool
      if (response.stopReason === 'tool_use') {
        const toolUse = response.output.message.content.find((c: any) => c.toolUse);

        if (toolUse) {
          console.log('Claude wants to use tool:', toolUse.toolUse.name, toolUse.toolUse.input);

          // Call MCP tool using the proper SDK method
          const toolResult = await mcpClient!.callTool({
            name: toolUse.toolUse.name,
            arguments: toolUse.toolUse.input
          });

          toolResults.push({
            toolUseId: toolUse.toolUse.toolUseId,
            content: toolResult.content
          });

          // Add tool result to conversation
          messages.push({
            role: 'assistant',
            content: response.output.message.content
          });

          // Format tool result for Bedrock - content should be an array
          const toolResultContent = Array.isArray(toolResult.content)
            ? toolResult.content
            : [{ text: JSON.stringify(toolResult.content) }];

          messages.push({
            role: 'user',
            content: [{
              toolResult: {
                toolUseId: toolUse.toolUse.toolUseId,
                content: toolResultContent
              }
            }]
          });

          iterations++;
          continue;
        }
      }

      // If we get here, Claude gave a final response
      break;
    }

    // Extract text response
    const textContent = response.output.message.content.find((c: any) => c.text);
    const responseText = textContent ? textContent.text : 'No response generated';

    res.json({
      message: responseText,
      toolsUsed: toolResults.map(tr => tr.toolUseId),
      conversationHistory: [
        ...conversationHistory,
        { role: 'user', content: message },
        { role: 'assistant', content: responseText }
      ]
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mcpConnected: !!mcpClient });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend API listening on port ${PORT}`);
  console.log('Initializing MCP...');
  initMCP().catch(console.error);
});
