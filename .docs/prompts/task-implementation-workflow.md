# Task Implementation Workflow - TDD Approach

## Overview

This document provides a Test-Driven Development (TDD) workflow that incorporates our established 5-phase workflow protocol for implementing tasks defined using our Task Description Blueprint. Every task should be developed incrementally, with tests written first to ensure atomic, testable deliverables.

## 🔄 WORKFLOW PROTOCOL

You MUST follow this exact 5-phase loop for EVERY task implementation:

### Phase 1: RESEARCH & CLARIFY (Before ANY coding)
- [ ] Read ALL relevant documentation first
- [ ] Check latest package versions and changelogs  
- [ ] Ask questions until scope is 100% unambiguous:
  - What files/modules will be affected?
  - What are the acceptance criteria?
  - What are the edge cases?
  - What are the dependencies?
  - Are there existing patterns to follow?

### Phase 2: PLAN - Create detailed implementation plan
- [ ] Verify all dependency versions first
- [ ] List all files to create/modify with full paths
- [ ] Define module interfaces with TypeScript types
- [ ] Specify test cases (unit + integration + edge cases)
- [ ] Identify potential risks and mitigation strategies
- [ ] Document platform abstraction approach
- [ ] Create task breakdown into TDD cycles

### Phase 3: IMPLEMENT - Write code following TDD
- [ ] Set up development environment first
- [ ] Write interface definitions
- [ ] Write tests FIRST (aim for 90%+ coverage)
- [ ] Implement minimal code to pass tests
- [ ] Use dependency injection for all services
- [ ] Separate core logic from platform code
- [ ] Return complete, working code (not patches)
- [ ] Include all configuration files
- [ ] Fix root causes, don't write defensive code

### Phase 4: SELF-REVIEW - Complete checklist before submission
- [ ] Tests: Happy path + edge cases + error cases
- [ ] Code: DRY/SOLID principles applied
- [ ] Architecture: Clear separation of concerns
- [ ] Naming: Self-documenting variables/functions
- [ ] Comments: Explain WHY, not WHAT
- [ ] Types: Full TypeScript coverage, no 'any'
- [ ] Performance: <100ms for all operations
- [ ] Security: Input validation, sanitization
- [ ] Cross-platform: Windows, macOS, Linux tested
- [ ] Documentation: README updated if needed
- [ ] Update task board with progress

### Phase 5: COMMIT - Create atomic commits
- [ ] Run all tests locally first
- [ ] Lint and format code
- [ ] Write descriptive commit message (<72 chars)
- [ ] Include ticket/task reference
- [ ] Update CHANGELOG.md if applicable

---

## Core TDD Principles

### 1. Red-Green-Refactor Cycle
1. **RED**: Write a failing test that defines desired behavior
2. **GREEN**: Write minimal code to make the test pass
3. **REFACTOR**: Improve code quality while keeping tests green

### 2. Test-First Mindset
- Tests are specifications, not afterthoughts
- If it's hard to test, the design needs work
- Each test should verify one specific behavior

### 3. Incremental Progress
- One test at a time
- Commit after each green state
- Build features through accumulation of passing tests

---

## Detailed TDD Implementation Within Each Phase

### Phase 1 Integration: Research & Clarify → Test Discovery

During research, identify:
- Existing test patterns in the codebase
- Testing frameworks and conventions used
- Coverage requirements and standards
- Platform-specific testing considerations

### Phase 2 Integration: Plan → Test-First Design

#### Step 1: Task Analysis (15-30 min)
```markdown
1. Read task description thoroughly
2. Break down acceptance criteria into testable units
3. Identify edge cases and error scenarios
4. Create test checklist from acceptance criteria
5. Map tests to platform abstractions
```

#### Step 2: Test Planning
Transform each acceptance criterion into test cases:

**Acceptance Criterion:**
"PUT /api/v1/users/{id}/profile endpoint returns 200 with updated user object on success"

**Test Cases:**
```
- ✓ should return 200 status code
- ✓ should return updated user object
- ✓ should persist changes to database
- ✓ should update the updated_at timestamp
```

### Phase 3 Integration: Implement → TDD Cycles

Execute multiple TDD cycles within the implementation phase:

#### 3.1 Write First Failing Test
```javascript
// Example: API endpoint test
describe('PUT /api/v1/users/:id/profile', () => {
  it('should return 200 status code', async () => {
    const response = await request(app)
      .put('/api/v1/users/123/profile')
      .send({ first_name: 'John' })
      .set('Authorization', 'Bearer valid-token');
    
    expect(response.status).toBe(200);
  });
});
```

#### 3.2 Run Test - Verify Failure
```bash
npm test -- --watch
# Test should fail (endpoint doesn't exist)
```

#### 3.3 Write Minimal Code
```javascript
// Just enough to make the test pass
app.put('/api/v1/users/:id/profile', authenticate, (req, res) => {
  res.status(200).json({});
});
```

#### 3.4 Run Test - Verify Success
```bash
# Test should now pass
```

#### 3.5 Refactor (if needed)
- Extract constants
- Improve naming
- Remove duplication
- Keep tests green

#### 3.6 Micro-Commit (Within Implementation)
```bash
git add .
git commit -m "feat: add profile update endpoint - returns 200"
```

#### 3.7 Next Test
Repeat cycle for next behavior...

**Note**: These micro-commits during implementation are separate from the Phase 5 COMMIT, which represents a complete, reviewable unit of work.

---

## Test Organization by Task Type

### API/Backend Tasks
```
1. Contract Tests (endpoint exists, methods)
2. Validation Tests (input validation)
3. Business Logic Tests (core functionality)
4. Integration Tests (database, external services)
5. Error Handling Tests (edge cases)
```

### Frontend/UI Tasks
```
1. Component Render Tests (it renders)
2. User Interaction Tests (clicks, inputs)
3. State Management Tests (data flow)
4. Integration Tests (API calls)
5. Accessibility Tests (a11y compliance)
```

### Data/Model Tasks
```
1. Schema Tests (structure, types)
2. Validation Tests (constraints)
3. Relationship Tests (associations)
4. Query Tests (performance, correctness)
```

---

## Practical Examples

### Example 1: API Endpoint (TDD Steps)

**Task**: Create user profile update endpoint

#### Test 1: Endpoint Exists
```javascript
// RED
it('should return 200 for valid request', async () => {
  const response = await request(app)
    .put('/api/v1/users/123/profile')
    .send({ first_name: 'John' });
  expect(response.status).toBe(200);
});

// GREEN - Add route
app.put('/api/v1/users/:id/profile', (req, res) => {
  res.sendStatus(200);
});

// ✓ Commit: "feat: add profile update endpoint"
```

#### Test 2: Authentication Required
```javascript
// RED
it('should return 401 without auth token', async () => {
  const response = await request(app)
    .put('/api/v1/users/123/profile')
    .send({ first_name: 'John' });
  expect(response.status).toBe(401);
});

// GREEN - Add auth middleware
app.put('/api/v1/users/:id/profile', authenticate, (req, res) => {
  res.sendStatus(200);
});

// ✓ Commit: "feat: require authentication for profile updates"
```

#### Test 3: Validate Input
```javascript
// RED
it('should return 400 for invalid bio length', async () => {
  const response = await request(app)
    .put('/api/v1/users/123/profile')
    .set('Authorization', 'Bearer token')
    .send({ bio: 'x'.repeat(501) });
  expect(response.status).toBe(400);
});

// GREEN - Add validation
app.put('/api/v1/users/:id/profile', 
  authenticate,
  validateProfileInput,
  (req, res) => {
    res.sendStatus(200);
  }
);

// ✓ Commit: "feat: add profile input validation"
```

### Example 2: Frontend Component (TDD Steps)

**Task**: Add to cart button

#### Test 1: Button Renders
```javascript
// RED
it('should render add to cart button', () => {
  render(<ProductDetail product={mockProduct} />);
  expect(screen.getByText('Add to Cart')).toBeInTheDocument();
});

// GREEN - Add button
function ProductDetail({ product }) {
  return (
    <div>
      <button>Add to Cart</button>
    </div>
  );
}

// ✓ Commit: "feat: add cart button to product detail"
```

#### Test 2: Click Handler
```javascript
// RED
it('should call addToCart when clicked', () => {
  const addToCart = jest.fn();
  render(<ProductDetail product={mockProduct} addToCart={addToCart} />);
  fireEvent.click(screen.getByText('Add to Cart'));
  expect(addToCart).toHaveBeenCalledWith(mockProduct.id);
});

// GREEN - Add click handler
function ProductDetail({ product, addToCart }) {
  return (
    <div>
      <button onClick={() => addToCart(product.id)}>
        Add to Cart
      </button>
    </div>
  );
}

// ✓ Commit: "feat: handle add to cart click"
```

---

## Phase 4 Integration: Self-Review → Test Quality Assurance

### Test-Specific Review Checklist
- [ ] All acceptance criteria have corresponding tests
- [ ] Test coverage meets 90%+ requirement
- [ ] Tests are isolated and independent
- [ ] Test names clearly describe behavior
- [ ] No flaky or timing-dependent tests
- [ ] Platform-specific tests where needed
- [ ] Performance benchmarks included
- [ ] Security tests for input validation

## Atomic Task Checklist

### Before Phase 1 (Research):
- [ ] Do I understand the testing requirements?
- [ ] Are there existing test patterns to follow?

### Before Phase 2 (Plan):
- [ ] Can I write a test for each acceptance criterion?
- [ ] Have I identified all edge cases?
- [ ] Is each test focused on one behavior?

### During Phase 3 (Implement):
- [ ] Am I writing the test first?
- [ ] Is my test failing for the right reason?
- [ ] Am I writing minimal code to pass?
- [ ] Can I micro-commit after this test passes?

### During Phase 4 (Review):
- [ ] Are all tests green?
- [ ] Is test coverage adequate?
- [ ] Are tests maintainable?

### Before Phase 5 (Commit):
- [ ] Have all tests passed locally?
- [ ] Is this a complete, deployable increment?
- [ ] Does commit message reference the task?

---

## Best Practices

### DO:
- Write one test at a time
- Commit after each passing test
- Keep tests simple and focused
- Test behavior, not implementation
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)

### DON'T:
- Write multiple tests before implementing
- Test private methods/implementation details
- Write tests after code
- Skip the refactor step
- Make large leaps between tests
- Commit with failing tests

### Test Naming Convention
```javascript
// Format: should [expected behavior] when [condition]
it('should return 404 when user does not exist')
it('should update timestamp when profile is modified')
it('should disable button when item already in cart')
```

---

## Integration with Task Blueprint

### Workflow Phase Mapping

| Workflow Phase | Task Blueprint Section | Focus |
|----------------|------------------------|-------|
| Phase 1: Research | Context/Background, Dependencies | Understand the problem |
| Phase 2: Plan | Acceptance Criteria, Technical Requirements | Design test strategy |
| Phase 3: Implement | Testing Requirements, Implementation Notes | Execute TDD cycles |
| Phase 4: Review | Definition of Done | Verify quality |
| Phase 5: Commit | Task Status Update | Document completion |

### Reading a Task Through Workflow Lens
1. **Phase 1**: Study Context/Background and existing patterns
2. **Phase 2**: Transform Acceptance Criteria into test plan
3. **Phase 3**: Use Technical Requirements to guide TDD
4. **Phase 4**: Verify against Definition of Done
5. **Phase 5**: Update task status and commit

### Progress Tracking Across Phases
```markdown
## Task: [PROJ-XXX] Implementation Progress

### Phase 1: Research ✓
- [x] Reviewed existing auth patterns
- [x] Checked framework documentation
- [x] Clarified validation requirements

### Phase 2: Plan ✓
- [x] Identified 8 test scenarios
- [x] Defined TypeScript interfaces
- [x] Created implementation checklist

### Phase 3: Implement (In Progress)
#### TDD Cycles:
- [x] Cycle 1: Endpoint exists → test + code ✓
- [x] Cycle 2: Auth required → test + code ✓
- [ ] Cycle 3: Input validation → test + code
- [ ] Cycle 4: Database update → test + code

### Phase 4: Review (Pending)
- [ ] All tests passing
- [ ] Code review checklist
- [ ] Performance verified

### Phase 5: Commit (Pending)
- [ ] Final test run
- [ ] Commit with task reference
```

---

## Common Patterns

### Error Handling Tests First
```javascript
// Always test error cases before happy path
it('should return 404 for non-existent user')
it('should return 400 for invalid input')
it('should return 401 for unauthorized')
// Then test success cases
it('should return 200 with updated data')
```

### Edge Cases as Tests
```javascript
// Transform edge cases into tests immediately
it('should handle empty string as valid')
it('should handle maximum length input')
it('should handle special characters')
it('should handle concurrent updates')
```

### Incremental Feature Building
```
Step 1: Basic functionality (core happy path)
Step 2: Input validation
Step 3: Error handling  
Step 4: Edge cases
Step 5: Performance optimizations
```

---

## Measuring Success

### Task Completion Metrics
- All acceptance criteria have corresponding passing tests
- Test coverage meets project standards (usually >80%)
- Each commit represents a working increment
- No untested code in production

### Quality Indicators
- Small, frequent commits
- Clear test descriptions
- Fast test execution
- Minimal test maintenance
- Easy to add new features

---

## Quick Reference Card

```
5-PHASE WORKFLOW with TDD:

1. RESEARCH & CLARIFY
   └─ Understand before coding
   
2. PLAN
   └─ Design tests from requirements
   
3. IMPLEMENT (TDD Loop)
   └─ RED → GREEN → REFACTOR → MICRO-COMMIT
   
4. SELF-REVIEW
   └─ Verify quality & coverage
   
5. COMMIT
   └─ Ship complete increment

TDD Within Implementation:
• RED - Write failing test
• GREEN - Make it pass  
• REFACTOR - Improve code
• MICRO-COMMIT - Save progress
• REPEAT - Next test

Golden Rules:
✓ No code without failing test
✓ 90%+ coverage target
✓ Fix root causes, not symptoms
✓ Atomic, deployable commits
```

## Related Documents

- **Task Description Blueprint** (`/.docs/prompts/task-description-blueprint.md`): Defines WHAT to build
- **Workflow Protocol** (`/.docs/prompts/workflow.md`): Our core 5-phase process
- **This Document**: Integrates TDD methodology into the workflow phases