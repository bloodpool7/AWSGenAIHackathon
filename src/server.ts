#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";
import FormData from "form-data";
import "dotenv/config";

/**
 * Minimal Onshape STL importer that lets an LLM pass *any* ASCII STL string.
 *
 * The LLM is expected to:
 *   1. Generate valid ASCII STL for the user request.
 *   2. Call the `import_stl` tool below, supplying the STL text (or Base‑64 encoded if preferred)
 *      together with an optional document name / filename.
 *
 * This server does **not** call external LLM APIs – it simply forwards the STL
 * it receives to Onshape.
 */

const ONSHAPE_API_URL = process.env.ONSHAPE_API_URL || "https://cad.onshape.com/api/v6";
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

/** Helper for Onshape REST API */
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
        opts.body = body; // multipart – FormData sets boundary & content‑type
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
    const server = new McpServer({
        name: "Onshape STL Importer",
        version: "2.0.0",
        description:
            "Creates an Onshape document from an ASCII STL string supplied by the LLM.",
    });

    /**
     * MCP tool: import_stl
     *
     * Parameters expected from the LLM:
     *   stl              – (required) The ASCII STL text representing the model.
     *   documentName     – (optional) Name for the new Onshape document.
     *   filename         – (optional) Filename for the blob element (default: model.stl).
     *   createNewPartStudio – (optional) Whether to create a new Part Studio (default: false).
     */
    server.tool(
        "import_stl",
        {
            stl: z
                .string()
                .min(1)
                .describe("ASCII STL content to import into Onshape"),
            documentName: z
                .string()
                .optional()
                .describe("Name for the new Onshape document (default: 'AI Model <ISO date>')"),
            filename: z
                .string()
                .optional()
                .describe("Filename for the STL blob (default: 'model.stl')"),
            createNewPartStudio: z
                .boolean()
                .optional()
                .describe("Create a new Part Studio for the STL import (default false)"),
        },
        async (params: {
            stl: string;
            documentName?: string;
            filename?: string;
            createNewPartStudio?: boolean;
        }) => {
            try {
                const docName = params.documentName ?? `AI Model ${new Date().toISOString()}`;
                const fileName = params.filename ?? "model.stl";

                // 1️⃣ Create a private document
                const doc = await onshapeApiRequest<DocumentResponse>("POST", "/documents", {
                    name: docName,
                    public: false,
                });

                // 2️⃣ Upload the STL as a blob element
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

                // 3️⃣ Import the blob into the (default) Part Studio
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
                            text: `❌ Error importing STL: ${err.message}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // Start the server (stdio transport)
    await server.connect(new StdioServerTransport());
}

startServer().catch(console.error);
