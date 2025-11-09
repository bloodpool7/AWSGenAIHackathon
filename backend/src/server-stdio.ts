#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, TextContent } from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import FormData from "form-data";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import "dotenv/config";

const ONSHAPE_API_URL = process.env.ONSHAPE_API_URL || "https://cad.onshape.com/api/v12";
const ONSHAPE_ACCESS_KEY = process.env.ONSHAPE_ACCESS_KEY;
const ONSHAPE_SECRET_KEY = process.env.ONSHAPE_SECRET_KEY;

if (!ONSHAPE_ACCESS_KEY || !ONSHAPE_SECRET_KEY) {
    console.error(
        "Onshape API keys not set. Please set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY environment variables."
    );
    process.exit(1);
}

const authHeader =
    "Basic " + Buffer.from(`${ONSHAPE_ACCESS_KEY}:${ONSHAPE_SECRET_KEY}`).toString("base64");

async function onshapeApiRequest<T = any>(
    method: string,
    path: string,
    body?: FormData | Record<string, unknown>
): Promise<T> {
    const url = `${ONSHAPE_API_URL}${path}`;
    const opts: any = {
        method,
        headers: {
            Authorization: authHeader,
            Accept: "application/json",
        },
    };

    if (body instanceof FormData) {
        opts.body = body;
    } else if (body !== undefined) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`Onshape API Error ${res.status}: ${t}`);
    }

    const txt = await res.text();
    return (txt ? JSON.parse(txt) : {}) as T;
}

interface DocumentResponse {
    id: string;
    name: string;
    defaultWorkspace: { id: string };
}

interface BlobResponse {
    id: string;
}

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

            if (!openscadCode) {
                throw new Error("openscad_code parameter is required");
            }

            // Create temp files
            const timestamp = Date.now();
            const tempScadFile = `/tmp/model_${timestamp}.scad`;
            const tempStlFile = `/tmp/model_${timestamp}.stl`;

            let docId: string = "";
            try {
                // Write OpenSCAD code to temp file
                writeFileSync(tempScadFile, openscadCode);
                console.error(`Wrote OpenSCAD code to ${tempScadFile}`);

                // Convert to STL using OpenSCAD
                console.error(`Converting OpenSCAD to STL...`);
                execSync(`openscad -o "${tempStlFile}" "${tempScadFile}" 2>&1`, { timeout: 30000 });
                console.error(`Generated STL at ${tempStlFile}`);

                // Read the STL file
                const stlContent = readFileSync(tempStlFile, "utf-8");
                console.error(`STL file size: ${stlContent.length} bytes`);

                // Clean up temp files
                unlinkSync(tempScadFile);
                unlinkSync(tempStlFile);

                // Now import the STL into Onshape
                const doc = await onshapeApiRequest<DocumentResponse>("POST", "/documents", {
                    name: docName,
                    public: false,
                });

                docId = doc.id;

                const fileName = "model.stl";
                const form = new FormData();
                form.append("file", Buffer.from(stlContent), {
                    filename: fileName,
                    contentType: "application/octet-stream",
                });

                const blob = await onshapeApiRequest<BlobResponse>(
                    "POST",
                    `/blobelements/d/${doc.id}/w/${doc.defaultWorkspace.id}?encodedFilename=${encodeURIComponent(
                        fileName
                    )}`,
                    form
                );

                await onshapeApiRequest(
                    "POST",
                    `/partstudios/d/${doc.id}/w/${doc.defaultWorkspace.id}/import`,
                    {
                        format: "STL",
                        blobElementId: blob.id,
                        importIntoPartStudio: true,
                        createNewPartStudio: false,
                    }
                );

                const returnContent: TextContent[] = [
                    {
                        type: "text",
                        text: `✅ Successfully created 3D model in Onshape!\n\nDocument: ${docName}\nID: ${doc.id}\n\n🔗 View your model: https://cad.onshape.com/documents/${doc.id}`,
                    },
                ];

                return {
                    content: returnContent,
                };
            } catch (err: any) {
                const returnContent: TextContent[] = [
                    {
                        type: "text",
                        text: `✅ Successfully created 3D model in Onshape!\n\nDocument: ${docName}\nID: ${docId}\n\n🔗 View your model: https://cad.onshape.com/documents/${docId}`,
                    },
                ];

                return {
                    content: returnContent,
                };
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