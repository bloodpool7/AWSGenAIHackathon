#!/bin/bash

# MCP Server Setup Script for Onshape
set -e  # Exit on any error

echo "Setting up Onshape MCP Server..."
echo

# Step 1: Build the server
echo "Building the server..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed! Please check your npm configuration."
    exit 1
fi

echo "✅ Server built successfully!"
echo

# Step 2: Get project directory
PROJECT_DIRECTORY=$(pwd)
echo "Project directory: $PROJECT_DIRECTORY"
echo

# Step 3: Set up Claude Desktop config file path
CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Claude"
CLAUDE_CONFIG_FILE="$CLAUDE_CONFIG_DIR/claude_desktop_config.json"

echo "Claude config file: $CLAUDE_CONFIG_FILE"

# Step 4: Create config directory if it doesn't exist
if [ ! -d "$CLAUDE_CONFIG_DIR" ]; then
    echo "Creating Claude config directory..."
    mkdir -p "$CLAUDE_CONFIG_DIR"
fi

# Step 5: Handle config file creation or validation
if [ ! -f "$CLAUDE_CONFIG_FILE" ]; then
    echo "Creating new claude_desktop_config.json file..."
    cat > "$CLAUDE_CONFIG_FILE" << 'EOF'
{
  "mcpServers": {}
}
EOF
    echo "✅ Config file created!"
else
    echo "✅ Config file already exists!"
    # Check if mcpServers tag exists, add it if it doesn't
    echo "Checking for proper formatting"
    
    # Use Node.js to check and add mcpServers if missing
    node -e "
    const fs = require('fs');
    const path = '$CLAUDE_CONFIG_FILE';
    
    try {
        const config = JSON.parse(fs.readFileSync(path, 'utf8'));
        
        if (!config.mcpServers) {
            config.mcpServers = {};
            fs.writeFileSync(path, JSON.stringify(config, null, 2));
        }
    } catch (error) {
        console.error('❌ Error checking config file:', error.message);
        process.exit(1);
    }
    "
    
    if [ $? -ne 0 ]; then
        echo "❌ Failed to validate configuration file!"
        exit 1
    fi
fi

echo

# Step 6: Get API keys from user
echo "🔑 Setting up Onshape API credentials..."
echo "Please enter your Onshape API credentials."
echo "Leave blank to use current environment variables."
echo

# Function to mask API key for display
mask_key() {
    local key="$1"
    if [ -n "$key" ] && [ ${#key} -gt 8 ]; then
        echo "${key:0:4}...${key: -4}"
    elif [ -n "$key" ]; then
        echo "${key:0:2}..."
    else
        echo ""
    fi
}

# Show masked current values
current_access_display=$(mask_key "$ONSHAPE_ACCESS_KEY")
current_secret_display=$(mask_key "$ONSHAPE_SECRET_KEY")

read -p "ONSHAPE_ACCESS_KEY [${current_access_display}]: " input_access_key
read -p "ONSHAPE_SECRET_KEY [${current_secret_display}]: " input_secret_key

# Use input or fall back to environment variables
if [ -n "$input_access_key" ]; then
    FINAL_ACCESS_KEY="$input_access_key"
else
    FINAL_ACCESS_KEY="$ONSHAPE_ACCESS_KEY"
fi

if [ -n "$input_secret_key" ]; then
    FINAL_SECRET_KEY="$input_secret_key"
else
    FINAL_SECRET_KEY="$ONSHAPE_SECRET_KEY"
fi

# Validate that we have keys
if [ -z "$FINAL_ACCESS_KEY" ] || [ -z "$FINAL_SECRET_KEY" ]; then
    echo "❌ Error: Both ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY are required!"
    echo "Please set them as environment variables or provide them when prompted."
    exit 1
fi

echo "✅ API keys configured!"
echo

# Step 7: Update the config file with the new server
echo "Adding onshape_mcp server to configuration..."

# Create a backup of the existing config
cp "$CLAUDE_CONFIG_FILE" "$CLAUDE_CONFIG_FILE.backup.$(date +%Y%m%d_%H%M%S)"
echo "Backup created: $CLAUDE_CONFIG_FILE.backup.$(date +%Y%m%d_%H%M%S)"

# Use Node.js to safely update the JSON file
node -e "
const fs = require('fs');
const path = '$CLAUDE_CONFIG_FILE';

try {
    // Read existing config
    const config = JSON.parse(fs.readFileSync(path, 'utf8'));
    
    // Ensure mcpServers exists
    if (!config.mcpServers) {
        config.mcpServers = {};
    }
    
    // Add onshape_mcp server
    config.mcpServers['onshape_mcp'] = {
        command: 'node',
        args: ['$PROJECT_DIRECTORY/dist/server.js'],
        env: {
            ONSHAPE_ACCESS_KEY: '$FINAL_ACCESS_KEY',
            ONSHAPE_SECRET_KEY: '$FINAL_SECRET_KEY',
            ONSHAPE_API_URL: 'https://cad.onshape.com/api/v11'
        }
    };
    
    // Write updated config
    fs.writeFileSync(path, JSON.stringify(config, null, 2));
    console.log('✅ Configuration updated successfully!');
    
} catch (error) {
    console.error('❌ Error updating configuration:', error.message);
    process.exit(1);
}
"

if [ $? -ne 0 ]; then
    echo "❌ Failed to update configuration file!"
    exit 1
fi

echo

# Step 8: Final success message
echo "✅ Setup complete! ✅"
echo
echo "Summary:"
echo "   • Server built: $PROJECT_DIRECTORY/dist/server.js"
echo "   • Config file: $CLAUDE_CONFIG_FILE"
echo "   • Server name: onshape_mcp"
echo "   • API URL: https://cad.onshape.com/api/v11"
echo
echo "⚠️  Important: Please restart Claude Desktop for changes to take effect."
echo
echo "To verify your setup, you can check the config file:"
echo "   cat \"$CLAUDE_CONFIG_FILE\""
echo