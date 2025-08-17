#!/bin/bash

echo "🚀 Setting up Claudine MCP Server for Claude Code"
echo "================================================="
echo ""

# Check if MCP config directory exists
MCP_DIR="$HOME/.config/claude"
MCP_CONFIG="$MCP_DIR/mcp_servers.json"

echo "📁 Checking MCP configuration directory..."
if [ ! -d "$MCP_DIR" ]; then
    echo "Creating directory: $MCP_DIR"
    mkdir -p "$MCP_DIR"
fi

echo "📝 MCP Config location: $MCP_CONFIG"
echo ""

# Check if config exists
if [ -f "$MCP_CONFIG" ]; then
    echo "⚠️  Existing MCP configuration found!"
    echo "Current content:"
    echo "---"
    cat "$MCP_CONFIG"
    echo "---"
    echo ""
    echo "Please manually add the following to your config:"
else
    echo "Creating new MCP configuration..."
    cp /workspace/claudine/config/mcp-config-ready.json "$MCP_CONFIG"
    echo "✅ Configuration created!"
fi

echo ""
echo "📋 Add this to your MCP config:"
echo "================================"
cat /workspace/claudine/config/mcp-config-ready.json
echo ""
echo "================================"
echo ""

# Test the server
echo "🧪 Testing server startup..."
if timeout 2 node /workspace/claudine/dist/index.js 2>&1 | grep -q "Claudine MCP Server running"; then
    echo "✅ Server test successful!"
else
    echo "⚠️  Server test inconclusive"
fi

echo ""
echo "✨ Setup Instructions:"
echo "----------------------"
echo "1. If you have existing MCP config, manually merge the above"
echo "2. If not, the config has been created at: $MCP_CONFIG"
echo "3. Start a NEW Claude Code session (not --continue)"
echo "4. Test with: 'Use DelegateTask to run: echo Hello from Claudine'"
echo ""
echo "📌 Note: Using MOCK_MODE=true for testing without Claude CLI"
echo ""
echo "To verify tools are available in Claude Code:"
echo "  - Start new session: claude"
echo "  - Ask: 'What MCP tools are available?'"
echo ""