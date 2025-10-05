#!/bin/bash

# Start the backend API for frontend chat integration
export ONSHAPE_ACCESS_KEY="on_MbbD7rBrxSC06uYCPO3nL"
export ONSHAPE_SECRET_KEY="LHS5Xe942iNbWzPUcT435ZLvK8CcEeuj7JZWlVBMcO1ogcTM"
export PORT=3001

echo "🚀 Starting Onshape MCP Backend API..."
echo "📡 Server will run on http://localhost:3001"
echo "📝 Frontend can POST to /api/chat"
echo ""

npx tsx backend-api.ts
