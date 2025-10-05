import express from 'express';
import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
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

// Streaming chat endpoint
app.post('/api/chat/stream', async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!mcpClient) {
      await initMCP();
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Format conversation history for Claude
    const messages = [
      ...conversationHistory.map((msg: any) => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? [{ text: msg.content }] : msg.content
      })),
      { role: 'user', content: [{ text: message }] }
    ];

    let toolResults: any[] = [];
    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      // Call Claude with available tools (streaming)
      const command = new ConverseStreamCommand({
        modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        messages,
        toolConfig: {
          tools: availableTools
        }
      });

      const response = await bedrock.send(command);
      
      let fullText = '';
      let toolUseBlock: any = null;
      let stopReason = '';

      // Stream the response
      if (response.stream) {
        for await (const chunk of response.stream) {
          if (chunk.contentBlockDelta?.delta?.text) {
            const text = chunk.contentBlockDelta.delta.text;
            fullText += text;
            // Send text chunk to client
            res.write(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`);
          }

          if (chunk.contentBlockStart?.start?.toolUse) {
            toolUseBlock = {
              toolUseId: chunk.contentBlockStart.start.toolUse.toolUseId,
              name: chunk.contentBlockStart.start.toolUse.name,
              input: ''
            };
          }

          if (chunk.contentBlockDelta?.delta?.toolUse) {
            toolUseBlock.input += chunk.contentBlockDelta.delta.toolUse.input || '';
          }

          if (chunk.messageStop) {
            stopReason = chunk.messageStop.stopReason || '';
          }
        }
      }

      // Check if Claude wants to use a tool
      if (stopReason === 'tool_use' && toolUseBlock) {
        // Parse tool input
        const toolInput = JSON.parse(toolUseBlock.input);
        
        res.write(`data: ${JSON.stringify({ 
          type: 'tool_use', 
          tool: toolUseBlock.name,
          status: 'calling'
        })}\n\n`);

        console.log('Claude wants to use tool:', toolUseBlock.name, toolInput);

        // Call MCP tool
        const toolResult = await mcpClient!.callTool({
          name: toolUseBlock.name,
          arguments: toolInput
        });

        toolResults.push({
          toolUseId: toolUseBlock.toolUseId,
          content: toolResult.content
        });

        res.write(`data: ${JSON.stringify({ 
          type: 'tool_use', 
          tool: toolUseBlock.name,
          status: 'completed'
        })}\n\n`);

        // Add tool result to conversation
        messages.push({
          role: 'assistant',
          content: [
            ...(fullText ? [{ text: fullText }] : []),
            {
              toolUse: {
                toolUseId: toolUseBlock.toolUseId,
                name: toolUseBlock.name,
                input: toolInput
              }
            }
          ]
        });

        const toolResultContent = Array.isArray(toolResult.content)
          ? toolResult.content
          : [{ text: JSON.stringify(toolResult.content) }];

        messages.push({
          role: 'user',
          content: [{
            toolResult: {
              toolUseId: toolUseBlock.toolUseId,
              content: toolResultContent
            }
          }]
        });

        iterations++;
        fullText = ''; // Reset for next iteration
        continue;
      }

      // If we get here, Claude gave a final response
      break;
    }

    // Send completion event
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();

  } catch (error) {
    console.error('Error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
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
