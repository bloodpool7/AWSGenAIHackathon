#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import "dotenv/config";   

async function startServer() {
    const server = new Server({
        name: "OpenSCAD to Onshape",
        version: "2.0.0",
    }, {
        capabilities: {
            tools: {},
        },
    });

    // Register tools
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: "create_from_openscad",
                description: "Creates a 3D model in Onshape from OpenSCAD code. This tool handles the entire workflow: converts OpenSCAD code to STL, then imports it into Onshape. Use this when you need to create 3D CAD models.",
                inputSchema: {
                    type: "object",
                    properties: {
                        openscad_code: {
                            type: "string",
                            description: "The OpenSCAD code to convert and import. Should be valid OpenSCAD syntax.",
                        },
                        document_name: {
                            type: "string",
                            description: "Name for the new Onshape document (default: 'AI Model <ISO date>')",
                        },
                    },
                    required: ["openscad_code"],
                },
            },
        ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const toolName = request.params.name;

        // Handle create_from_openscad tool
        if (toolName === "create_from_openscad") {
            const params = request.params.arguments as any;
            const openscadCode = params.openscad_code;
            const docName = params.document_name ?? `AI Model ${new Date().toISOString()}`;
            
                        
            let docId: string = "";
            try {
                const response = await fetch("http://localhost:8000/create_from_openscad", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        openscad_code: openscadCode,
                        document_name: docName,
                    }),
                });
                const data = await response.json();
                if (data.success) {
                    docId = data.docId;
                    return {
                        content: [
                            {
                                type: "text",
                                text: `✅ Successfully created 3D model in Onshape!\n\nDocument: ${docName}\nID: ${docId}\n\n🔗 View your model: https://cad.onshape.com/documents/${docId}`,
                            },
                        ],
                    }
                } else {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `❌ Failed to create 3D model: ${data.error}`,
                            },
                        ],
                    }
                }
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `❌ Failed to create 3D model: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                }
            }
        }
        throw new Error(`Unknown tool: ${toolName}`);
    });

    // Use stdio transport for Claude Desktop
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error("Onshape MCP Server running on stdio");
}

startServer().catch(console.error);