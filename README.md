# lark-to-codewhale

Connect Feishu / Lark messenger to your local [Codewhale](https://github.com/Hmbown/CodeWhale) CLI coding agent. Run the bot, scan a QR code, and talk to an AI coding agent directly from chat — it can read files, edit code, run commands, and maintain session context across conversations.


Thanks to the inspiration from https://github.com/zarazhangrui/feishu-claude-code-bridge

[中文 README](./README.zh.md)

## What it does

- Forwards Feishu / Lark messages (DM directly, or `@bot` in a group) to your local `codewhale` CLI, running in a working directory you control.
- **Streaming card**: Codewhale's text and tool calls update on a single Lark card in real time — no waiting for the final reply.
- **Project + thread sessions**: one Feishu chat owns one project cwd; each thread/topic gets its own Codewhale session.
- **Preempt + batch**: a new message interrupts the running run; rapid-fire messages get coalesced into one request.
- **Multiple workspaces**: `/ws` switches between named project directories, with sessions tracked per workspace.
- **Images and files**: send them to the bot directly — Codewhale reads the locally downloaded paths.
- **Rich Lark output**: with bound `lark-cli`, Codewhale can send rich text, tables, images/files, interactive cards, and Docx links back to the current chat/thread.
- **Interactive cards**: `/help`, `/ws list`, `/status` return cards with buttons you can click; Codewhale-generated cards can route button clicks back into the same session.
- **Feishu docs workflow**: `/doc <request>` and `/spec <request>` ask Codewhale to create/update a Feishu Docx and return the link.


## Prerequisites

- **Node.js >= 20**
- **Codewhale CLI** installed and logged in — see [CodeWhale](https://github.com/Hmbown/CodeWhale)
- A **Feishu / Lark PersonalAgent app** (the QR-code wizard on first launch can create one for you)

## Install

```bash
npm install -g lark-to-codewhale
# or
pnpm add -g lark-to-codewhale
```

## Quick start

```bash
lark-to-codewhale run
```

First launch detects no app credentials and opens a QR-code wizard:

1. A QR code appears in your terminal
2. Scan it with the Feishu / Lark app
3. Pick or create a PersonalAgent app
4. Credentials are saved to `~/.lark-codewhale/config.json`

The bot is now running. DM it or add it to a group and `@bot` to start chatting.

## Usage

### Chat commands (in Feishu / Lark)

| Command | Description |
|---------|-------------|
| `/new` or `/reset` | Start a fresh Codewhale session in current chat/thread |
| `/new chat [name]` | Create a new group inheriting the current cwd |
| `/resume [N]` | List/recover recent Codewhale sessions |
| `/status` | Show project cwd, session scope, agent status |
| `/cd <path>` | Change project working directory for this chat |
| `/ws list\|save\|use\|remove` | Manage named workspaces |
| `/doc <request>` / `/spec <request>` | Create/update a Feishu Docx via Codewhale |
| `/stop` | Stop the current agent run |
| `/timeout [N\|off\|default]` | Override idle timeout for current session |
| `/config` | Open preferences form card |
| `/account` | View or switch app credentials |
| `/doctor [description]` | Self-diagnosis — feeds recent logs to Codewhale |
| `/ps` | List running bridge processes |
| `/exit <id\|#>` | Kill a bridge process |
| `/reconnect` | Force WebSocket reconnection |
| `/help` | Show help card |

### CLI commands (terminal)

**Process-level (foreground):**

| Command | Description |
|---------|-------------|
| `lark-to-codewhale run` | Run the bot in foreground |
| `lark-to-codewhale run -c <path>` | Run with custom config path |
| `lark-to-codewhale run --skip-check-lark-cli` | Skip lark-cli preflight |
| `lark-to-codewhale ps` | List running bridge processes |
| `lark-to-codewhale kill <id\|#>` | Kill a bridge process |

**Service-level (OS daemon):** supports macOS (launchd), Linux (systemd), Windows (Task Scheduler).

```bash
# Install globally first
npm install -g lark-to-codewhale

lark-to-codewhale start       # Install & start daemon
lark-to-codewhale stop        # Stop daemon
lark-to-codewhale restart     # Restart daemon
lark-to-codewhale status      # Show daemon status
lark-to-codewhale unregister  # Remove daemon service
```

**Secrets management:**

```bash
lark-to-codewhale secrets set --app-id <id>     # Encrypt and store App Secret
lark-to-codewhale secrets get                   # Exec-provider protocol (for lark-cli)
lark-to-codewhale secrets list                  # List stored secret IDs
lark-to-codewhale secrets remove --app-id <id>  # Remove a stored secret
```

## Configuration

The bot stores its config at `~/.lark-codewhale/config.json` (auto-created on first run).

### Preferences (set via `/config` in chat)

| Option | Default | Description |
|--------|---------|-------------|
| `messageReply` | `markdown` | Reply format: `card`, `markdown`, or `text` |
| `showToolCalls` | `true` | Show tool call blocks in output |
| `maxConcurrentRuns` | `10` | Max concurrent Codewhale runs (max 50) |
| `runIdleTimeoutMinutes` | — | Auto-stop run after N min idle (0=off, 1-120) |
| `requireMentionInGroup` | `true` | Require `@bot` in group chats to respond |
| `agentStopGraceMs` | `5000` | SIGTERM → SIGKILL grace period (ms) |

### Environment variables

| Variable | Description |
|----------|-------------|
| `HTTPS_PROXY` / `HTTP_PROXY` | Proxy URL for Feishu API and WebSocket calls |
| `LARK_CODEWHALE_LOG_DAYS` | Log retention in days (default: 7) |
| `LARK_CODEWHALE_DISABLE_CAPABILITY_PROMPT` | Set to `1` to disable Lark capability hints in prompts |

### Access control (set via `/config`)

- **Allowed users**: only listed `open_id`s can talk to the bot (empty = all allowed)
- **Allowed chats**: only listed `chat_id` groups can trigger responses (DM is unaffected)
- **Admins**: only admins can run `/config`, `/account`, `/exit`, `/ws`, `/cd`, `/doctor`, `/reconnect`

## Key features

- **Streaming cards**: Codewhale output updates on a single Lark card in real time
- **Per-chat project**: each chat has its own working directory (cwd)
- **Per-thread session**: each thread/topic gets an independent Codewhale session
- **Preempt + batch**: new message interrupts current run; rapid messages coalesce into one request
- **Image/file support**: send files to the bot; Codewhale reads the locally cached paths
- **Rich output** (with bound `lark-cli`): Codewhale can send tables, images, cards, and Docx links back to chat
- **Interactive cards**: bot responses can contain clickable buttons routed back into the same session
- **Feishu docs workflow**: `/doc` and `/spec` create/update Feishu Docx documents

## License

MIT
