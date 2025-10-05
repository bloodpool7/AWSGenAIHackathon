import express from 'express';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';


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
  
  // FILTER OUT import_stl tool - force OpenSCAD workflow only
  availableTools = toolsResult.tools
    .filter((tool: any) => !tool.name.includes('import_stl'))  // Block raw STL imports
    .map((tool: any) => ({
      toolSpec: {
        name: tool.name,
        description: tool.description,
        inputSchema: {
          json: tool.inputSchema
        }
      }
    }));

  console.log('MCP Client initialized with tools:', availableTools.map(t => t.toolSpec.name));
  console.log('⚠️  import_stl tool DISABLED - OpenSCAD workflow enforced');
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
    const maxIterations = 10; // Increased for complex geometry generation

    while (iterations < maxIterations) {
      // Call Claude with available tools
      // Using Claude Sonnet 4.5 via cross-region inference profile
      const command = new ConverseCommand({
        modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        messages,
        system: [{
          text: `You are a 3D CAD assistant that generates OpenSCAD code ONLY.

🚫 ABSOLUTELY FORBIDDEN: You MUST NOT generate raw STL data (lines with "facet normal", "vertex", "outer loop", etc.)
✅ REQUIRED: You MUST generate OpenSCAD code in markdown code blocks

OpenSCAD is a programming language for creating 3D CAD objects. It's MUCH easier and more reliable than raw STL.

=== OPENSCAD BASICS ===

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

=== YOUR TASK ===

When the user requests a 3D object:
1. Think about how to decompose it into primitives
2. Write clean OpenSCAD code
3. Use modules for complex shapes
4. Use difference() for holes/subtractions
5. Use $fn=16 to 32 for cylinders/spheres (balance between smooth and efficient)

⚠️ CRITICAL FORMAT REQUIREMENT ⚠️

You MUST output OpenSCAD code in a markdown code block with the "openscad" language tag:

\`\`\`openscad
// Your OpenSCAD code here
cylinder(r=10, h=20, $fn=32);
\`\`\`

DO NOT:
- Generate raw STL geometry with "facet normal" / "vertex" lines
- Use any tools to import STL
- Try to create STL files yourself

The system will automatically:
1. Extract your OpenSCAD code
2. Convert it to STL using OpenSCAD
3. Import it to Onshape

Just write the OpenSCAD code and explain what you created!`
        }],
        ...(availableTools.length > 0 && {
          toolConfig: {
            tools: availableTools
          }
        })
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
    let responseText = textContent ? textContent.text : 'No response generated';

    // CRITICAL: Detect and reject raw STL generation
    if (responseText.includes('facet normal') || responseText.includes('vertex ') && responseText.includes('endfacet')) {
      console.error('❌ Claude generated raw STL instead of OpenSCAD! Rejecting...');
      return res.status(400).json({ 
        error: 'Raw STL generation detected. Please generate OpenSCAD code instead.',
        hint: 'Claude must output code in ```openscad blocks, not raw STL coordinates.'
      });
    }

    // Check if response contains OpenSCAD code
    const openscadMatch = responseText.match(/```(?:openscad|scad)?\s*\n([\s\S]*?)\n```/);
    if (openscadMatch) {
      const openscadCode = openscadMatch[1];
      console.log('Found OpenSCAD code, converting to STL...');
      
      // Save OpenSCAD code to temp file
      const tempScadFile = `/tmp/model_${Date.now()}.scad`;
      const tempStlFile = `/tmp/model_${Date.now()}.stl`;
      
      try {
        writeFileSync(tempScadFile, openscadCode);
        
        // Convert to STL using OpenSCAD
        // Note: OpenSCAD units are mm, but we'll let Onshape handle interpretation
        execSync(`openscad -o "${tempStlFile}" "${tempScadFile}" 2>&1`, { timeout: 30000 });
        
        // Read the STL
        const stlContent = readFileSync(tempStlFile, 'utf-8');
        
        // DEBUG: Save a copy for inspection
        const debugStlFile = `/tmp/debug_openscad_output.stl`;
        writeFileSync(debugStlFile, stlContent);
        console.log(`DEBUG: Saved STL to ${debugStlFile} for inspection`);
        
        // Clean up temp files
        unlinkSync(tempScadFile);
        unlinkSync(tempStlFile);
        
        console.log(`Generated STL: ${stlContent.length} bytes`);
        console.log(`First 500 chars: ${stlContent.substring(0, 500)}`);
        
        // Extract document name from user message
        const userMessage = req.body.message || '';
        const docNameMatch = userMessage.match(/(?:import|upload|create|name|call).*?["']([^"']+)["']/i) ||
                           userMessage.match(/(?:as|named)\s+["']?([^"'\n]+)["']?/i);
        const documentName = docNameMatch ? docNameMatch[1] : `3D Model - ${new Date().toISOString().split('T')[0]}`;
        
        console.log(`Importing STL to Onshape as "${documentName}"...`);
        
        // Call the import STL tool (name from MCP server is 'import_stl')
        const importResult = await mcpClient!.callTool({
          name: 'import_stl',
          arguments: {
            stl_content: stlContent,
            document_name: documentName
          }
        });
        
        console.log('Import completed!', importResult);
        responseText += `\n\n✅ STL generated and imported to Onshape as "${documentName}"!`;
        
      } catch (error: any) {
        console.error('Error in OpenSCAD workflow:', error);
        responseText += `\n\n❌ Error: ${error.message}`;
      }
    }

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
