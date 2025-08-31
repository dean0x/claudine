# Task Description Blueprint

## Task Structure Template

### 1. Task Title
- **Format**: `[Component/Area] Action + Object + Context`
- **Examples**: 
  - "User Auth: Implement password reset flow"
  - "API: Add pagination to products endpoint"
  - "UI: Create responsive navigation menu"

### 2. Task ID & Metadata
```
Task ID: [PROJ-XXX]
Priority: [Critical/High/Medium/Low]
Estimated Effort: [XS/S/M/L/XL] or [Story Points]
Dependencies: [List of task IDs this depends on]
Blocks: [List of task IDs blocked by this]
```

### 3. Context/Background
- **Why**: Business value and user impact
- **Current State**: What exists now (if anything)
- **Problem Statement**: What gap this addresses

### 4. Acceptance Criteria
Use clear, testable statements:
- [ ] Given [context], when [action], then [expected result]
- [ ] System must [specific requirement]
- [ ] User can [specific capability]

### 5. Technical Requirements
- **API Changes**: Endpoints, contracts, versions
- **Database Changes**: Schema updates, migrations
- **Dependencies**: External services, libraries
- **Performance**: Response time, load requirements
- **Security**: Authentication, authorization, data handling

### 6. Implementation Notes
- Suggested approach (not prescriptive)
- Known gotchas or considerations
- Links to relevant documentation
- Code examples or patterns to follow

### 7. Testing Requirements
- Unit test coverage expectations
- Integration test scenarios
- Manual testing steps
- Edge cases to consider

### 8. Definition of Done
- [ ] Code reviewed and approved
- [ ] Tests written and passing
- [ ] Documentation updated
- [ ] Deployed to staging environment
- [ ] Product owner acceptance

---

## Task Breakdown Guidelines

### 1. Size Principles
- **Atomic**: Each task should deliver one complete piece of functionality
- **1-3 Day Rule**: Tasks should be completable in 1-3 days
- **Single Responsibility**: One task = one deliverable

### 2. Dependency Management
- **Linear Dependencies**: A → B → C (preferred)
- **Parallel Work**: Identify tasks that can be done simultaneously
- **Risk Mitigation**: Critical path items first

### 3. Task Types

#### Foundation Tasks
- Database schema setup
- API scaffolding
- Core data models
- Basic CRUD operations

#### Feature Tasks
- User-facing functionality
- Business logic implementation
- UI components
- Integration points

#### Polish Tasks
- Error handling
- Loading states
- Edge case handling
- Performance optimization

#### Infrastructure Tasks
- Deployment setup
- Monitoring/logging
- Security hardening
- Documentation

### 4. Writing Clear Descriptions

#### DO:
- Use active voice ("Implement" not "Implementation of")
- Be specific about inputs/outputs
- Include mockups/wireframes when relevant
- Define edge cases explicitly
- Specify data formats and validations

#### DON'T:
- Use ambiguous terms ("properly", "correctly", "as needed")
- Assume context or knowledge
- Mix multiple features in one task
- Leave acceptance criteria open-ended
- Skip non-functional requirements

---

## Example Task Descriptions

### Example 1: API Task
```markdown
## Task: User Profile - Create Update Profile Endpoint

**Task ID**: PROJ-042
**Priority**: High
**Effort**: M (3 points)
**Dependencies**: PROJ-041 (User model creation)
**Blocks**: PROJ-043 (Profile UI implementation)

### Context
Users need to update their profile information after registration. Currently, profile data is read-only.

### Acceptance Criteria
- [ ] PUT /api/v1/users/{id}/profile endpoint exists
- [ ] Endpoint accepts: first_name, last_name, bio, avatar_url
- [ ] Returns 200 with updated user object on success
- [ ] Returns 400 for invalid data
- [ ] Returns 404 for non-existent user
- [ ] Only authenticated users can update their own profile

### Technical Requirements
- Validate bio max length: 500 characters
- Avatar URL must be valid HTTPS URL
- Use existing authentication middleware
- Update user.updated_at timestamp

### Testing Requirements
- Unit tests for validation logic
- Integration tests for full endpoint flow
- Test authorization (can't update other users)
```

### Example 2: Frontend Task
```markdown
## Task: Shopping Cart - Implement Add to Cart Button

**Task ID**: PROJ-089
**Priority**: Critical
**Effort**: S (2 points)
**Dependencies**: PROJ-087 (Product detail page)
**Blocks**: PROJ-090 (Cart dropdown UI)

### Context
Users viewing product details need ability to add items to their shopping cart for purchase.

### Acceptance Criteria
- [ ] "Add to Cart" button displays on product detail page
- [ ] Clicking button adds item to cart state
- [ ] Button shows loading state during API call
- [ ] Success message appears after adding
- [ ] Button disabled if item already in cart
- [ ] Cart icon badge updates with item count

### Technical Requirements
- Use existing Button component from design system
- Call POST /api/v1/cart/items endpoint
- Update global cart context/state
- Handle network errors gracefully

### Implementation Notes
- Button component: src/components/Button
- Cart context: src/contexts/CartContext
- Follow existing pattern in WishlistButton component
```

---

## Task Sequencing Best Practices

### 1. Vertical Slicing
Break features into end-to-end slices:
1. Database/Model layer
2. API/Business logic
3. Frontend/UI
4. Integration/Polish

### 2. Risk-First Approach
- Identify technical unknowns early
- Create spike/research tasks when needed
- Build riskiest components first

### 3. Incremental Value Delivery
- Each task should be deployable
- Users can benefit from partial features
- Feature flags for gradual rollout

### 4. Review Checkpoints
Insert review tasks at key milestones:
- After core functionality
- Before major integrations
- After UI implementation
- Before production deployment

---

## Communication Templates

### Daily Standup Format
```
Task: [PROJ-XXX] [Title]
Status: [Not Started/In Progress/Blocked/Complete]
Progress: [What was accomplished]
Next: [What's planned today]
Blockers: [Any impediments]
```

### Handoff Template
```
Task: [PROJ-XXX] ready for development
- All dependencies complete: ✓
- Designs attached: ✓
- API contracts defined: ✓
- Test data available: ✓
Questions? -> [PM name]
```

---

## Quality Checklist

Before finalizing a task description, verify:

- [ ] Title clearly describes the deliverable
- [ ] Acceptance criteria are measurable
- [ ] Dependencies are identified
- [ ] Technical constraints are documented
- [ ] Edge cases are considered
- [ ] Testing approach is clear
- [ ] Definition of done is complete
- [ ] Effort estimate seems reasonable
- [ ] Task can be completed independently
- [ ] Value to user is apparent