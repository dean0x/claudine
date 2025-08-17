#!/bin/bash

# Create GitHub release for Claudine v0.1.0

echo "🚀 Creating GitHub release for Claudine v0.1.0..."

# Create the release
gh release create v0.1.0 \
  --title "Claudine v0.1.0 - Initial Release" \
  --notes-file RELEASE_NOTES.md \
  --latest \
  --verify-tag

if [ $? -eq 0 ]; then
    echo "✅ Release created successfully!"
    echo "📎 View at: https://github.com/dean0x/claudine/releases/tag/v0.1.0"
    
    # Also set repo description and topics
    echo ""
    echo "📝 Updating repository settings..."
    
    gh repo edit dean0x/claudine \
      --description "MCP server for delegating tasks to background Claude Code instances" \
      --add-topic mcp \
      --add-topic claude \
      --add-topic claude-code \
      --add-topic automation \
      --add-topic typescript \
      --add-topic task-delegation
    
    echo "✅ Repository settings updated!"
else
    echo "❌ Failed to create release. Please check your authentication."
fi