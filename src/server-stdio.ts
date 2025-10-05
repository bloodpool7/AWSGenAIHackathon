#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import FormData from "form-data";
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
        name: "Onshape STL Importer",
        version: "2.0.0",
    }, {
        capabilities: {
            tools: {},
        },
    });

    // Register the import_stl tool
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: "import_stl",
                description: "Creates an Onshape document from an ASCII STL string",
                inputSchema: {
                    type: "object",
                    properties: {
                        stl: {
                            type: "string",
                            description: "ASCII STL content to import into Onshape",
                        },
                        documentName: {
                            type: "string",
                            description: "Name for the new Onshape document (default: 'AI Model <ISO date>')",
                        },
                        filename: {
                            type: "string",
                            description: "Filename for the STL blob (default: 'model.stl')",
                        },
                        createNewPartStudio: {
                            type: "boolean",
                            description: "Create a new Part Studio for the STL import (default false)",
                        },
                    },
                    required: ["stl"],
                },
            },
        ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (request.params.name !== "import_stl") {
            throw new Error(`Unknown tool: ${request.params.name}`);
        }

        try {
            const params = request.params.arguments as any;
            const docName = params.documentName ?? `AI Model ${new Date().toISOString()}`;
            const fileName = params.filename ?? "model.stl";

            // Create document
            const doc = await onshapeApiRequest<DocumentResponse>("POST", "/documents", {
                name: docName,
                public: false,
            });

            // Upload STL blob
            const form = new FormData();
            form.append("file", Buffer.from(params.stl), {
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

            // Import into Part Studio
            await onshapeApiRequest(
                "POST",
                `/partstudios/d/${doc.id}/w/${doc.defaultWorkspace.id}/import`,
                {
                    format: "STL",
                    blobElementId: blob.id,
                    importIntoPartStudio: true,
                    createNewPartStudio: params.createNewPartStudio ?? false,
                }
            );

            return {
                content: [
                    {
                        type: "text",
                        text: `🎉 Imported STL into Onshape!\nDocument: ${docName}\nID: ${doc.id}\nView: https://cad.onshape.com/documents/${doc.id}`,
                    },
                ],
            };
        } catch (err: any) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${err.message}`,
                    },
                ],
                isError: true,
            };
        }
    });

    // Use stdio transport for Claude Desktop
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error("Onshape MCP Server running on stdio");
}

startServer().catch(console.error);

