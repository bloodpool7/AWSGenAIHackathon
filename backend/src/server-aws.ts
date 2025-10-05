#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { validateCognitoToken } from "./oauth-cognito.js";
import { z } from "zod";
import express, { Request, Response, NextFunction } from "express";
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

const getServer = () => {
  // Create server instance
  const server = new McpServer({
    name: "onshape-stl-importer",
    version: "2.0.0",
    capabilities: {
      resources: {},
      tools: {},
    },
  });

  // Register the import_stl tool
  server.tool(
    "import_stl",
    "Creates an Onshape document from an ASCII STL string",
    {
      stl: z.string().describe("ASCII STL content to import into Onshape"),
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
    async ({ stl, documentName, filename, createNewPartStudio }) => {
      try {
        const docName = documentName ?? `AI Model ${new Date().toISOString()}`;
        const fileName = filename ?? "model.stl";

        // Create document
        const doc = await onshapeApiRequest<DocumentResponse>("POST", "/documents", {
          name: docName,
          public: false,
        });

        // Upload STL blob
        const form = new FormData();
        form.append("file", Buffer.from(stl), {
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
            createNewPartStudio: createNewPartStudio ?? false,
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
              text: `🎉 Imported STL into Onshape!`,
            },
          ],
        };
      }
    }
  );

  return server;
};

const app = express();
app.use(express.json());

/**
 * Get WWW-Authenticate header for 401 responses.
 */
function getWWWAuthenticateHeader(req: Request): string {
  const protocol = req.get("X-Forwarded-Proto") || req.protocol;
  const baseUrl = process.env.BASE_URL || `${protocol}://${req.get("host")}`;
  const val = `Bearer realm="mcp-server", resource_metadata="${baseUrl}/onshape/.well-known/oauth-protected-resource"`;
  console.log(val);
  return val;
}

/**
 * Send a 401 Unauthorized response with the appropriate WWW-Authenticate header.
 */
function sendUnauthorizedResponse(req: Request, res: Response): void {
  res.setHeader("WWW-Authenticate", getWWWAuthenticateHeader(req));
  res.status(401).json({
    jsonrpc: "2.0",
    error: {
      code: -32600,
      message: "Unauthorized. Valid authentication credentials required.",
    },
    id: null,
  });
}

/**
 * Middleware to authenticate requests using Cognito tokens.
 */
const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return sendUnauthorizedResponse(req, res);
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  // Check if token is actually present after "Bearer "
  if (!token || token.trim() === "") {
    return sendUnauthorizedResponse(req, res);
  }

  try {
    const { isValid } = await validateCognitoToken(token);
    if (!isValid) {
      return sendUnauthorizedResponse(req, res);
    }
  } catch (error) {
    console.error("Token validation error:", error);
    return sendUnauthorizedResponse(req, res);
  }

  next();
};

/**
 * OAuth 2.0 Protected Resource Metadata endpoint.
 * Implements RFC9728 specification.
 */
app.get(
  "/onshape/.well-known/oauth-protected-resource",
  (req: Request, res: Response) => {
    const region = process.env.AWS_REGION || "us-west-2";
    const user_pool_id = process.env.COGNITO_USER_POOL_ID;
    const protocol = req.get("X-Forwarded-Proto") || req.protocol;
    const baseUrl = process.env.BASE_URL || `${protocol}://${req.get("host")}`;

    res.json({
      resource: `${baseUrl}/onshape/mcp`,
      authorization_servers: [
        `https://cognito-idp.${region}.amazonaws.com/${user_pool_id}`,
      ],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "email", "profile"],
    });
  }
);

// Health check
app.get("/onshape/", async (req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    service: "onshape-mcp",
  });
});

// Apply authentication middleware to MCP endpoints
app.use("/onshape/mcp", authMiddleware);

app.post("/onshape/mcp", async (req: Request, res: Response) => {
  // In stateless mode, create a new instance of transport and server for each request
  // to ensure complete isolation. A single instance would cause request ID collisions
  // when multiple clients connect concurrently.

  try {
    const server = getServer();
    const transport: StreamableHTTPServerTransport =
      new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
    res.on("close", () => {
      console.log("Request closed");
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

// SSE notifications not supported in stateless mode
app.get("/onshape/mcp", async (req: Request, res: Response) => {
  console.log("Received GET MCP request");
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    })
  );
});

// Session termination not needed in stateless mode
app.delete("/onshape/mcp", async (req: Request, res: Response) => {
  console.log("Received DELETE MCP request");
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    })
  );
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Onshape MCP server listening on port ${PORT}`);
});
