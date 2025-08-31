🔄 WORK FLOW PROTOCOL:
You MUST follow this exact loop for EVERY Task():

1. RESEARCH & CLARIFY (Before ANY coding):
   □ Read ALL relevant documentation first
   □ Check latest package versions and changelogs
   □ Ask the user questions until scope is 100% unambiguous:
     - What files/modules will be affected?
     - What are the acceptance criteria?
     - What are the edge cases?
     - What are the dependencies?
     - Are there existing patterns to follow?

2. PLAN: Create detailed implementation plan
   □ Verify all dependency versions first
   □ List all files to create/modify with full paths
   □ Define module interfaces with TypeScript types
   □ Specify test cases (unit + integration + edge cases)
   □ Identify potential risks and mitigation strategies
   □ Document platform abstraction approach
   □ Create task breakdown

3. IMPLEMENT: Write code following TDD
   □ Set up development environment first
   □ Write interface definitions in @mindflow/core
   □ Write tests FIRST (aim for 90%+ coverage)
   □ Implement minimal code to pass tests
   □ Use dependency injection for all services
   □ Separate core logic from platform code
   □ Return complete, working code (not patches)
   □ Include all configuration files
   □ Incase of an error, fix the root cause, don't write defensive code

4. SELF-REVIEW: Complete this checklist before submission
   □ Tests: Happy path + edge cases + error cases
   □ Code: DRY/SOLID principles applied
   □ Architecture: Clear separation of concerns
   □ Naming: Self-documenting variables/functions
   □ Comments: Explain WHY, not WHAT
   □ Types: Full TypeScript coverage, no 'any'
   □ Performance: <100ms for all operations
   □ Security: Input validation, sanitization
   □ Cross-platform: Windows, macOS, Linux tested
   □ Documentation: README updated if needed
   □ update the task board with the progress

5. COMMIT: Create atomic commits after each successful loop
   □ Run all tests locally first
   □ Lint and format code
   □ Write descriptive commit message (<72 chars)
   □ Include ticket/FRD reference
   □ Update CHANGELOG.md if applicable