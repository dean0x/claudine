#!/bin/bash

echo "🚀 Claudine MCP Server Installation"
echo "===================================="
echo ""

# Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null)
if [ $? -ne 0 ]; then
    echo "❌ Node.js is not installed"
    echo "Please install Node.js 20.0.0 or higher"
    exit 1
fi

echo "✅ Node.js version: $NODE_VERSION"

# Check npm version
NPM_VERSION=$(npm -v 2>/dev/null)
if [ $? -ne 0 ]; then
    echo "❌ npm is not installed"
    exit 1
fi

echo "✅ npm version: $NPM_VERSION"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Build project
echo ""
echo "🔨 Building project..."
npm run build

# Check if build succeeded
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build successful!"
else
    echo ""
    echo "❌ Build failed"
    exit 1
fi

# Get absolute path
INSTALL_PATH=$(pwd)

# Detect OS and show config location
echo ""
echo "📝 Configuration Instructions"
echo "----------------------------"
echo ""

if [[ "$OSTYPE" == "darwin"* ]] || [[ "$OSTYPE" == "linux-gnu"* ]]; then
    CONFIG_PATH="$HOME/.config/claude/mcp_servers.json"
    echo "Unix-based OS detected"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    CONFIG_PATH="%USERPROFILE%\\.config\\claude\\mcp_servers.json"
    echo "Windows detected"
else
    CONFIG_PATH="~/.config/claude/mcp_servers.json"
    echo "OS: $OSTYPE"
fi

echo "MCP config file location: $CONFIG_PATH"
echo ""
echo "Add this to your Claude Code MCP config:"
echo ""
echo '{'
echo '  "mcpServers": {'
echo '    "claudine": {'
echo '      "command": "node",'
echo "      \"args\": [\"$INSTALL_PATH/dist/index.js\"],"
echo '      "env": {}'
echo '    }'
echo '  }'
echo '}'
echo ""
echo "📋 The above configuration has been saved to config/mcp-config-snippet.json"

# Create config snippet file
mkdir -p config
cat > config/mcp-config-snippet.json << EOF
{
  "mcpServers": {
    "claudine": {
      "command": "node",
      "args": ["$INSTALL_PATH/dist/index.js"],
      "env": {}
    }
  }
}
EOF

echo ""
echo "🧪 Testing the server..."
echo ""

# Quick test
timeout 2 npm run dev 2>&1 | grep "Claudine MCP Server running" > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Server test successful!"
else
    echo "⚠️  Server test failed - but this might be normal"
    echo "   Try running: npm run dev"
fi

echo ""
echo "✨ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Copy the configuration above to your Claude Code MCP config"
echo "2. Start a new Claude Code session"
echo "3. Look for 'claudine' tools (DelegateTask, TaskStatus, etc.)"
echo ""
echo "For testing without Claude CLI:"
echo "  npm run test:mock"
echo ""