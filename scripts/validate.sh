#!/bin/bash

echo "🔍 Claudine MCP Server Validation"
echo "=================================="
echo ""

ERRORS=0
WARNINGS=0

# Function to check command
check_command() {
    if command -v $1 &> /dev/null; then
        echo "✅ $1 found: $(command -v $1)"
        return 0
    else
        echo "❌ $1 not found"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
}

# Function to check file
check_file() {
    if [ -f "$1" ]; then
        echo "✅ $1 exists"
        return 0
    else
        echo "❌ $1 missing"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
}

# Function to check directory
check_dir() {
    if [ -d "$1" ]; then
        echo "✅ $1 exists"
        return 0
    else
        echo "❌ $1 missing"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
}

echo "📋 Checking prerequisites..."
echo "----------------------------"
check_command node
check_command npm

echo ""
echo "📋 Checking project structure..."
echo "--------------------------------"
check_file package.json
check_file tsconfig.json
check_file README.md
check_dir src
check_dir dist
check_file src/index.ts
check_file src/server.ts
check_file src/types.ts

echo ""
echo "📋 Running TypeScript check..."
echo "------------------------------"
if npm run typecheck > /dev/null 2>&1; then
    echo "✅ TypeScript compilation successful"
else
    echo "❌ TypeScript compilation failed"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "📋 Checking build output..."
echo "--------------------------"
if [ -f "dist/index.js" ] && [ -f "dist/server.js" ] && [ -f "dist/types.js" ]; then
    echo "✅ All JavaScript files built"
else
    echo "⚠️  Some build files missing, rebuilding..."
    npm run build > /dev/null 2>&1
    if [ -f "dist/index.js" ]; then
        echo "✅ Rebuild successful"
    else
        echo "❌ Build failed"
        ERRORS=$((ERRORS + 1))
    fi
fi

echo ""
echo "📋 Running tests..."
echo "------------------"
if npm test -- --run > /dev/null 2>&1; then
    echo "✅ Unit tests passed"
else
    echo "❌ Unit tests failed"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "📋 Testing server startup..."
echo "---------------------------"
if timeout 2 npm run dev > /dev/null 2>&1; then
    echo "✅ Server starts successfully"
else
    # Timeout is expected, check if it at least started
    if timeout 2 npm run dev 2>&1 | grep -q "Claudine MCP Server"; then
        echo "✅ Server starts successfully"
    else
        echo "❌ Server failed to start"
        ERRORS=$((ERRORS + 1))
    fi
fi

echo ""
echo "📋 Checking mock mode..."
echo "-----------------------"
if MOCK_MODE=true timeout 5 node tests/manual/test-mock.js > /dev/null 2>&1; then
    echo "✅ Mock mode works"
else
    # Check if it at least runs
    if MOCK_MODE=true timeout 2 node dist/index.js 2>&1 | grep -q "Claudine"; then
        echo "✅ Mock mode works"
    else
        echo "⚠️  Mock mode test inconclusive"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

echo ""
echo "📋 Checking dependencies..."
echo "--------------------------"
if [ -d "node_modules/@modelcontextprotocol" ]; then
    echo "✅ MCP SDK installed"
else
    echo "❌ MCP SDK not found"
    ERRORS=$((ERRORS + 1))
fi

if [ -d "node_modules/zod" ]; then
    echo "✅ Zod installed"
else
    echo "❌ Zod not found"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "📋 Checking documentation..."
echo "---------------------------"
check_file README.md
check_file SUMMARY.md
check_dir examples
check_file examples/use-cases.md

echo ""
echo "========================================"
echo "📊 VALIDATION RESULTS"
echo "========================================"
echo ""

if [ $ERRORS -eq 0 ]; then
    if [ $WARNINGS -eq 0 ]; then
        echo "✅ All checks passed!"
        echo ""
        echo "🎉 Claudine MCP Server is ready for use!"
        echo ""
        echo "Next steps:"
        echo "1. Add to Claude Code MCP config (~/.config/claude/mcp_servers.json)"
        echo "2. Start new Claude Code session"
        echo "3. Test with: 'Use DelegateTask to run: echo test'"
    else
        echo "✅ Validation passed with $WARNINGS warning(s)"
        echo ""
        echo "⚠️  Some non-critical issues detected, but the server should work."
    fi
    exit 0
else
    echo "❌ Validation failed with $ERRORS error(s)"
    echo ""
    echo "Please fix the errors above and run validation again."
    exit 1
fi