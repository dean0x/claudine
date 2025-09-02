# 🐛 Claudine v0.2.1 - Critical Bug Fixes & Documentation Overhaul

## Critical Bug Fixes

### Task Resubmission Bug Fixed 🚨
- **Fixed**: Critical issue where tasks were resubmitted on every MCP server restart
- **Impact**: This bug was causing Claude instances to crash due to duplicate task execution
- **Solution**: Enhanced RecoveryManager to only restore QUEUED/RUNNING tasks, not all tasks
- **Added**: Duplicate prevention with TaskQueue.contains() method
- **Added**: Automatic cleanup of old completed tasks (7 day retention)

## Documentation Overhaul 📚

### New Documentation Files
- **FEATURES.md**: Complete list of all implemented features in v0.2.1
- **ROADMAP.md**: Unified roadmap replacing multiple conflicting versions  
- **CHANGELOG.md**: Proper version history with migration guides

### Documentation Fixes
- **README.md**: Updated to accurately reflect v0.2.1 capabilities
- **CLAUDE.md**: Added current architecture section
- **Archived**: Moved outdated/conflicting docs to `.docs/archive/`

## Build & Development Improvements 🛠️

### Fixed Missing Scripts
Added npm scripts that were documented but didn't exist:
```bash
npm run test:comprehensive  # Run tests with coverage
npm run test:coverage       # Same as above  
npm run validate           # Full validation pipeline
```

### Configuration Fixes
- Updated MCP configuration examples to use correct entry points
- Fixed package.json scripts section

## Migration Notes

- **No Breaking Changes**: Fully backward compatible with v0.2.0
- **Automatic Migration**: Database cleanup happens automatically on startup  
- **Same MCP Tools**: All existing MCP tool usage continues to work

## Installation

```bash
# Global installation
npm install -g claudine@0.2.1

# Or use latest
npm install -g claudine@latest
```

## What's Next

See [ROADMAP.md](./ROADMAP.md) for planned features:
- **v0.3.0**: Task dependency resolution (Q4 2025)
- **v0.4.0**: Distributed processing (Q1 2026)

---

**Full Changelog**: [CHANGELOG.md](./CHANGELOG.md)  
**Issues**: [GitHub Issues](https://github.com/dean0x/claudine/issues)