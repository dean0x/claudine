# Claude Code CLI Research

## Overview
Claude Code is a CLI tool that enables interaction with Claude AI models directly from the terminal. It provides sophisticated session management, context persistence, and automation capabilities.

## Key Features

### 1. Session Management

#### Resume Functionality
- **`--resume <session-id>`**: Resume a specific conversation by session ID
- **`--continue` or `-c`**: Continue the most recent conversation in current directory
- Sessions maintain full conversation history and context
- Session IDs are UUIDs for unique identification

#### Session Persistence
- Context persists via `CLAUDE.md` file (project memory)
- Sessions are directory-specific (tied to working directory)
- Automatic context compaction with `/compact` command
- Clear sessions with `/clear` command

### 2. CLI Flags and Options

| Flag | Description | Example |
|------|-------------|---------|
| `-p, --print` | Non-interactive mode | `claude -p "query"` |
| `--output-format` | Specify output format | `--output-format json` |
| `--resume` | Resume by session ID | `--resume abc123` |
| `--continue` | Continue recent session | `claude --continue` |
| `--model` | Select AI model | `--model sonnet` |
| `--add-dir` | Add working directories | `--add-dir ../src` |
| `--dangerously-skip-permissions` | Skip permission prompts | Use with caution |
| `--allowedTools` | Permit tools without prompts | `--allowedTools "Bash(git:)"` |

### 3. Output Formats
- **text**: Plain text output (default)
- **json**: Structured JSON response
- **stream-json**: Streaming JSON for real-time processing

### 4. Headless Mode (Automation)
```bash
# Non-interactive execution
claude -p "Analyze this code" --output-format json

# Continue session in headless mode
claude -p --resume "$(cat session.txt)" "Add unit tests"

# Pipe operations
tail -f app.log | claude -p "Alert on anomalies"
```

### 5. Memory Management

#### CLAUDE.md File
- Persistent project context
- Survives session clearing
- Team-shareable configuration
- Contains:
  - Project conventions
  - Architecture decisions
  - Important context
  - Custom instructions

#### Memory Shortcuts
- Start message with `#` to add to memory
- Example: `# This project uses PostgreSQL with Docker`
- Automatically appends to CLAUDE.md

### 6. Hooks System
Claude Code supports lifecycle hooks:
- **PreToolUse**: Before tool execution
- **PostToolUse**: After tool completion
- **Notification**: When Claude sends notifications
- **Stop**: When Claude finishes responding

Hooks receive JSON via stdin and can control execution flow.

### 7. Integration Capabilities

#### Unix Philosophy
- Composable and scriptable
- Works with pipes and redirects
- Integrates with existing tools
- CI/CD compatible

#### Examples
```bash
# CI integration
claude -p "Check for type errors and fix them"

# Log monitoring
tail -f app.log | claude -p "Monitor for errors"

# Git operations
claude -p "Create PR from these changes"
```

### 8. Performance Considerations
- Token management via `/compact` and `/clear`
- Context window optimization
- Automatic conversation summarization
- Efficient session storage

### 9. Best Practices
1. Use JSON output for programmatic parsing
2. Handle errors gracefully (check exit codes)
3. Implement timeouts for long-running operations
4. Use `/compact` at natural breakpoints
5. Clear sessions when switching tasks
6. Leverage CLAUDE.md for team knowledge sharing

## SDK Usage

### Basic Integration
```javascript
const { exec } = require('child_process');

// Spawn Claude in non-interactive mode
exec('claude -p "Your prompt" --output-format json', (error, stdout, stderr) => {
  if (!error) {
    const result = JSON.parse(stdout);
    console.log(result);
  }
});
```

### Session Management
```javascript
// Resume specific session
const sessionId = 'saved-session-id';
exec(`claude --resume ${sessionId} -p "Continue work"`, callback);

// Continue most recent
exec('claude --continue -p "What were we working on?"', callback);
```

## References
- [Claude Code SDK Documentation](https://docs.anthropic.com/en/docs/claude-code/sdk)
- [CLI Reference](https://docs.anthropic.com/en/docs/claude-code/cli-reference)
- [Claude Code Overview](https://docs.anthropic.com/en/docs/claude-code/overview)