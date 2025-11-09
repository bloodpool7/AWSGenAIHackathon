import express from 'express';
import { BedrockRuntimeClient, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
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
    command: 'npx',
    args: ['tsx', 'src/server-stdio.ts'],
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
  
  // Map all tools to Bedrock format
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
    const maxIterations = 10; // Increased for complex geometry generation
    let accumulatedFullText = ''; // Track all text across iterations

    while (iterations < maxIterations) {
      // Call Claude with available tools (streaming)
      const command = new ConverseStreamCommand({
        modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        messages,
        system: [{
          text: `You are a 3D CAD assistant that helps users create 3D models in Onshape using OpenSCAD code.

You have access to the "create_from_openscad" tool that converts OpenSCAD code into 3D models in Onshape.

=== OPENSCAD BASICS ===

OpenSCAD is a programming language for creating 3D CAD objects.

PRIMITIVES:
  cylinder(r=radius, h=height, center=false, $fn=32);  // $fn = number of facets (16-32 is good)
  cube([width, depth, height], center=false);           // [x, y, z] dimensions
  sphere(r=radius, $fn=32);                             // Use center=true to center at origin

TRANSFORMATIONS:
  translate([x, y, z]) object;   // Move object
  rotate([x_deg, y_deg, z_deg]) object;  // Rotate around axes
  scale([x_scale, y_scale, z_scale]) object;  // Scale object

BOOLEAN OPERATIONS:
  difference() { base_shape; shape_to_subtract; }  // Subtract
  union() { shape1; shape2; }                       // Combine
  intersection() { shape1; shape2; }                // Intersect

MODULES (Functions):
  module gear(teeth=8, radius=20) {
    // your code here
  }
  gear(teeth=10, radius=25);  // Call it

LOOPS:
  for (i = [0:7]) {  // Loop from 0 to 7
    rotate([0, 0, i * 45])  // Rotate each iteration
      cube([3, 8, 6]);
  }

=== GEAR EXAMPLE ===

module gear(teeth=8, outer_r=20, hole_r=4, thick=6) {
  tooth_angle = 360 / teeth;
  difference() {
    // Base cylinder
    cylinder(r=outer_r, h=thick, $fn=teeth*4);
    
    // Center hole
    translate([0, 0, -1])
      cylinder(r=hole_r, h=thick+2, $fn=32);
    
    // Teeth gaps (cut into the outer edge)
    for (i = [0:teeth-1]) {
      rotate([0, 0, i * tooth_angle + tooth_angle/2])
        translate([outer_r * 0.9, 0, -1])
          cylinder(r=outer_r*0.15, h=thick+2, $fn=8);
    }
  }
}

gear(teeth=8, outer_r=20, hole_r=4, thick=6);

=== YOUR WORKFLOW ===

When the user requests a 3D object:
1. Think about how to decompose it into primitives
2. Write clean OpenSCAD code
3. Use modules for complex shapes
4. Use difference() for holes/subtractions
5. Use $fn=16 to 32 for cylinders/spheres (balance between smooth and efficient)
6. FIRST, show the OpenSCAD code to the user in a markdown code block so they can learn from it:
   \`\`\`openscad
   // Your code here
   \`\`\`
7. THEN, call the "create_from_openscad" tool with:
   - openscad_code: The exact same OpenSCAD code (just the code, no markdown formatting)
   - document_name: A descriptive name for the model
8. After the tool returns successfully, provide a friendly summary message that includes the link from the tool result

The tool will handle converting it to STL and importing it into Onshape.

IMPORTANT: 
- ALWAYS show the code to the user first in a markdown block for educational purposes
- Then call the tool with the raw code (no markdown formatting in the tool call)
- After the tool completes, ALWAYS generate a follow-up message sharing the link and confirming success`
        }],
        ...(availableTools.length > 0 && {
          toolConfig: {
            tools: availableTools
          }
        })
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
        accumulatedFullText += fullText;
        fullText = ''; // Reset for next iteration
        continue;
      }

      // If we get here, Claude gave a final response
      accumulatedFullText += fullText;
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
