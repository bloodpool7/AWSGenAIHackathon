#!/bin/bash
echo "🚀 Starting Onshape MCP Backend API..."
echo "📡 Server will run on http://localhost:3001"
echo "📝 Frontend can POST to /api/chat"
echo ""

npx tsx backend-api.ts
