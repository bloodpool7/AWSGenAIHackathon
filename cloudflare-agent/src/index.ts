// src/index.ts
import {
	Agent,
	type AgentNamespace,
	getAgentByName,
  } from "agents";
  
  import {
	streamText,
	convertToModelMessages,
	tool,
	type UIMessage,
  } from "ai";
  import { anthropic } from '@ai-sdk/anthropic';
  import { z } from "zod";
  
  //
  // Env matches the Durable Object binding + any secrets you use
  //
  export interface Env {
	ChatAgent: AgentNamespace<ChatAgent>;
	OPENAI_API_KEY: string;
  }
  
  const model = anthropic("claude-sonnet-4-5");
  
  //
  // Tool: call your local FastAPI backend (OpenSCAD + Onshape)
  //
  const createFromOpenSCAD = tool({
	description:
	  "Create an Onshape model from OpenSCAD code via the local FastAPI backend.",
	inputSchema: z.object({
	  openscad_code: z
		.string()
		.describe("Valid OpenSCAD code to turn into an Onshape model."),
	  document_name: z
		.string()
		.optional()
		.describe("Optional Onshape document name."),
	}),
	async execute(input) {
	  const res = await fetch("http://localhost:8000/create_from_openscad", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	  });
  
	  if (!res.ok) {
		const text = await res.text();
		throw new Error(
		  `Onshape backend error ${res.status}: ${text || "no details"}`,
		);
	  }
  
	  // whatever your FastAPI returns: { success, docId, url, message, ... }
	  const response = await res.json();
	  return response;
	},
  });
  
  const allTools = {
	createFromOpenSCAD,
  };
  
  //
  // Agent implementation — this is the DO class referenced in wrangler.toml
  //
  export class ChatAgent extends Agent<Env> {
	async onRequest(request: Request): Promise<Response> {
	  if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	  }
  
	  // This matches what `useChat` sends by default: { messages: CoreMessage[] }
	  const { messages } = (await request.json()) as {
		messages: UIMessage[];
	  };
  
	  const result = streamText({	
		model,
		system: `You are a 3D CAD assistant that helps users create 3D models in Onshape using OpenSCAD code.
  
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
  - After the tool completes, ALWAYS generate a follow-up message sharing the link and confirming success`,
		messages: convertToModelMessages(messages),       // <- directly use CoreMessage[] from useChat
		tools: allTools // <- includes your FastAPI-backed create_from_openscad
	  });
  
	  // 🔑 This is the only thing you need to return for useChat:
	  return result.toUIMessageStreamResponse();
	}
  }
  
  //
  // Worker entry — this is where we use getAgentByName, per the docs
  //
  export default {
	async fetch(
	  request: Request,
	  env: Env,
	  _ctx: ExecutionContext,
	): Promise<Response> {
	  const url = new URL(request.url);
  
	  // CORS preflight handler
	  if (url.pathname === "/api/chat/stream" && request.method === "OPTIONS") {
		return new Response(null, {
		  status: 204,
		  headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": '*',
		  },
		});
	  }
  
	  if (url.pathname === "/api/chat/stream" && request.method === "POST") {
		const namedAgent = getAgentByName<Env, ChatAgent>(
		  env.ChatAgent,
		  "default-agent-id",
		);
  
		const resp = await (await namedAgent).fetch(request);
  
		// Add CORS headers to the streamed response too
		const respHeaders = new Headers(resp.headers);
		respHeaders.set("Access-Control-Allow-Origin", "*");
		respHeaders.set("Access-Control-Expose-Headers", "Content-Type");
  
		return new Response(resp.body, {
		  status: resp.status,
		  headers: respHeaders,
		});
	  }
  
	  return new Response("Not found", { status: 404 });
	},
  } satisfies ExportedHandler<Env>;
  