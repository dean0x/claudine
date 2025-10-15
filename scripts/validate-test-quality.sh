#!/bin/bash

# Test Quality Validation Script
# Enforces the standards defined in tests/TEST_STANDARDS.md
# Exit code: 0 if all checks pass, 1 if any violations found

echo "========================================="
echo "    Test Quality Validation Check"
echo "    Target Score: ≥85/100"
echo "========================================="
echo ""

VIOLATIONS=0
WARNINGS=0
SCORE=100

# Color codes
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Function to check for pattern in test files
check_pattern() {
    local pattern="$1"
    local message="$2"
    local severity="$3"
    local penalty="$4"

    count=$(grep -r "$pattern" tests/ --include="*.test.ts" --include="*.test.js" 2>/dev/null | wc -l)

    if [ $count -gt 0 ]; then
        if [ "$severity" = "critical" ]; then
            echo -e "${RED}❌ CRITICAL: $message (Found: $count instances)${NC}"
            VIOLATIONS=$((VIOLATIONS + count))
            SCORE=$((SCORE - penalty * count))
        else
            echo -e "${YELLOW}⚠️  WARNING: $message (Found: $count instances)${NC}"
            WARNINGS=$((WARNINGS + count))
            SCORE=$((SCORE - penalty * count))
        fi
        return 1
    else
        echo -e "${GREEN}✅ PASS: No $message${NC}"
        return 0
    fi
}

# Function to check for required files
check_file_exists() {
    local file="$1"
    local description="$2"

    if [ -f "$file" ]; then
        echo -e "${GREEN}✅ PASS: $description exists${NC}"
        return 0
    else
        echo -e "${RED}❌ CRITICAL: $description missing${NC}"
        VIOLATIONS=$((VIOLATIONS + 1))
        SCORE=$((SCORE - 10))
        return 1
    fi
}

echo "1. Checking Required Test Infrastructure..."
echo "-------------------------------------------"
check_file_exists "tests/fixtures/factories.ts" "Test factories"
check_file_exists "tests/fixtures/test-doubles.ts" "Test doubles"
check_file_exists "tests/constants.ts" "Test constants"
check_file_exists "tests/TEST_STANDARDS.md" "Test standards documentation"
echo ""

echo "2. Checking for Banned Patterns..."
echo "-------------------------------------------"
check_pattern "spyOn(console" "console spying" "critical" 3
check_pattern "as any" "'as any' type assertions" "critical" 2
check_pattern "vi\.fn()" "vi.fn() mocks (use test doubles)" "warning" 1
check_pattern "jest\.fn()" "jest.fn() mocks (use test doubles)" "warning" 1
check_pattern "console\.log" "console.log in tests" "warning" 1
check_pattern "console\.error" "console.error calls" "warning" 1
check_pattern "TODO.*implement.*test" "unimplemented tests" "critical" 5
check_pattern "expect(true)\.toBe(true)" "fake assertions" "critical" 5
echo ""

echo "3. Checking for Magic Numbers..."
echo "-------------------------------------------"
# Check for common magic numbers (exclude import statements and comments)
for num in 1000 5000 10000 1048576 10485760; do
    count=$(grep -r "\b$num\b" tests/ --include="*.test.ts" --include="*.test.js" 2>/dev/null | \
            grep -v "import" | grep -v "//" | grep -v "/\*" | wc -l)
    if [ $count -gt 0 ]; then
        echo -e "${YELLOW}⚠️  WARNING: Magic number $num found ($count times) - use constants${NC}"
        WARNINGS=$((WARNINGS + count))
        SCORE=$((SCORE - 1))
    fi
done

if [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✅ PASS: No magic numbers found${NC}"
fi
echo ""

echo "4. Checking Test Infrastructure Usage..."
echo "-------------------------------------------"
# Check for factory usage
factory_usage=$(grep -r "TaskFactory\|WorkerFactory\|ConfigFactory" tests/ --include="*.test.ts" 2>/dev/null | wc -l)
inline_objects=$(grep -r "{ *id: ['\"]task-\|{ *id: ['\"]worker-" tests/ --include="*.test.ts" 2>/dev/null | wc -l)

if [ $factory_usage -gt 0 ]; then
    echo -e "${GREEN}✅ Factory usage found: $factory_usage instances${NC}"
else
    echo -e "${RED}❌ No factory usage found!${NC}"
    SCORE=$((SCORE - 15))
fi

if [ $inline_objects -gt 0 ]; then
    echo -e "${YELLOW}⚠️  WARNING: Inline test objects found: $inline_objects instances${NC}"
    SCORE=$((SCORE - 2 * inline_objects))
fi

# Check for test double usage
double_usage=$(grep -r "TestEventBus\|TestLogger\|TestRepository" tests/ --include="*.test.ts" 2>/dev/null | wc -l)
if [ $double_usage -gt 0 ]; then
    echo -e "${GREEN}✅ Test double usage found: $double_usage instances${NC}"
else
    echo -e "${YELLOW}⚠️  WARNING: Consider using test doubles${NC}"
fi

# Check for constants usage
const_usage=$(grep -r "TIMEOUTS\.\|BUFFER_SIZES\.\|ERROR_MESSAGES\." tests/ --include="*.test.ts" 2>/dev/null | wc -l)
if [ $const_usage -gt 0 ]; then
    echo -e "${GREEN}✅ Constants usage found: $const_usage instances${NC}"
else
    echo -e "${YELLOW}⚠️  WARNING: Not using centralized constants${NC}"
fi
echo ""

echo "5. Checking Assertion Density..."
echo "-------------------------------------------"
test_count=$(grep -r "it(\|test(" tests/ --include="*.test.ts" 2>/dev/null | wc -l)
assertion_count=$(grep -r "expect(" tests/ --include="*.test.ts" 2>/dev/null | wc -l)

if [ $test_count -gt 0 ]; then
    avg_assertions=$((assertion_count / test_count))
    echo "Tests found: $test_count"
    echo "Assertions found: $assertion_count"
    echo "Average assertions per test: $avg_assertions"

    if [ $avg_assertions -ge 3 ]; then
        echo -e "${GREEN}✅ PASS: Good assertion density ($avg_assertions per test)${NC}"
    elif [ $avg_assertions -ge 2 ]; then
        echo -e "${YELLOW}⚠️  WARNING: Low assertion density ($avg_assertions per test, target: 3-5)${NC}"
        SCORE=$((SCORE - 5))
    else
        echo -e "${RED}❌ CRITICAL: Very low assertion density ($avg_assertions per test)${NC}"
        SCORE=$((SCORE - 10))
    fi
else
    echo -e "${RED}❌ No tests found!${NC}"
    SCORE=0
fi
echo ""

echo "6. Checking Error Test Coverage..."
echo "-------------------------------------------"
error_tests=$(grep -r "error\|fail\|throw\|catch\|reject" tests/ --include="*.test.ts" 2>/dev/null | grep -i "it(\|test(\|describe(" | wc -l)
if [ $error_tests -gt 0 ]; then
    echo -e "${GREEN}✅ Error tests found: $error_tests test cases${NC}"
else
    echo -e "${RED}❌ CRITICAL: No error test cases found${NC}"
    SCORE=$((SCORE - 15))
fi
echo ""

# Ensure score doesn't go below 0
if [ $SCORE -lt 0 ]; then
    SCORE=0
fi

echo "========================================="
echo "           FINAL REPORT"
echo "========================================="
echo ""
echo "Critical Violations: $VIOLATIONS"
echo "Warnings: $WARNINGS"
echo ""

# Determine pass/fail with color
if [ $SCORE -ge 85 ]; then
    echo -e "${GREEN}Quality Score: $SCORE/100 ✅ PASS${NC}"
    echo -e "${GREEN}Tests meet quality standards!${NC}"
    EXIT_CODE=0
elif [ $SCORE -ge 70 ]; then
    echo -e "${YELLOW}Quality Score: $SCORE/100 ⚠️  NEEDS IMPROVEMENT${NC}"
    echo "Target: 85/100"
    EXIT_CODE=1
else
    echo -e "${RED}Quality Score: $SCORE/100 ❌ FAIL${NC}"
    echo "Target: 85/100"
    echo ""
    echo -e "${RED}Tests do NOT meet quality standards!${NC}"
    EXIT_CODE=1
fi

echo ""
echo "========================================="
echo "           NEXT STEPS"
echo "========================================="
echo ""

if [ $VIOLATIONS -gt 0 ] || [ $WARNINGS -gt 0 ]; then
    echo "To improve your score:"
    echo "1. Read tests/TEST_STANDARDS.md"
    echo "2. Use test factories from tests/fixtures/factories.ts"
    echo "3. Use test doubles from tests/fixtures/test-doubles.ts"
    echo "4. Replace magic numbers with constants from tests/constants.ts"
    echo "5. Ensure 3-5 assertions per test"
    echo "6. Add error test cases for all components"
    echo "7. Remove console spying and use TestLogger"
    echo ""
    echo "Quick fixes:"
    echo "  - Replace inline objects with: new TaskFactory().build()"
    echo "  - Replace vi.fn() with: new TestEventBus()"
    echo "  - Replace magic numbers with: TIMEOUTS.MEDIUM"
    echo ""
fi

echo "For detailed audit run: /audit-tests"
echo ""

exit $EXIT_CODE