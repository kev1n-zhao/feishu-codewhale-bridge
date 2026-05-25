# lark-codewhale-bridge

A lightweight bot that bridges Feishu / Lark messenger with your local Codewhale CLI. Run one command, scan a QR code to bind a Lark app, and talk to Codewhale from chat — read screenshots, edit code, anything you'd do at the terminal.

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

- Node.js **>= 20**
- `codewhale` CLI installed and logged in — see https://github.com/Hmbown/CodeWhale
- A Lark / Feishu **PersonalAgent** app (the QR-code wizard on first launch can create one for you).

## Install

```bash
npm i -g lark-codewhale-bridge
# or
pnpm add -g lark-codewhale-bridge
```

## First run

```bash
lark-codewhale-bridge run
```

The first run detects there's no app configured and **opens a QR-code wizard**:

1. A QR code renders in your terminal.
2. Scan it with the Feishu / Lark app.
3. Pick or create a PersonalAgent app.
4. Credentials are written to `~/.lark-codewhale/config.json`.

## Commands

### In Lark / Feishu chat

```
/new | /reset                        Start a fresh session in the current chat/thread
/new chat [name]                     Create a new group and inherit the current project cwd
/resume [N]                          Resume a recent Codewhale session
/status                              Show project cwd, session scope, and agent status
/cd <path>                           Change the project cwd for this Feishu chat
/ws list|save|use|remove             Manage named workspaces
/doc <request> | /spec <request>     Create/update a Feishu Docx and send the link back
/stop                                Stop the current run
/timeout [N|off|default]             Override the idle timeout for this session
/config | /account | /doctor         Configure, switch app credentials, or self-diagnose
/ps | /exit <id|#> | /reconnect      Manage local bridge processes
```

`/doc` and `/spec` are available to normal allowed users. Management commands such as `/config`, `/account`, `/doctor`, `/cd`, `/ws`, `/exit`, and `/reconnect` still respect the admin allowlist.

### Host CLI

**Process-level** (run the bridge directly in your shell):

```
lark-codewhale-bridge run [-c <config>]     Run the bot in the foreground
lark-codewhale-bridge ps                    List all running bridge processes on this machine
lark-codewhale-bridge kill <id|#>           Kill a bridge process (SIGTERM, SIGKILL after 2s)
lark-codewhale-bridge --help                List all commands
```

**Service-level** (run the bridge as a background OS-managed daemon):

> ⚠️ **Install globally before using service-level commands.** The daemon's launchd plist / systemd unit / Windows task hard-codes the path to the bridge CLI. Use `npm install -g lark-codewhale-bridge` first.

```
lark-codewhale-bridge start                 Install (if needed) and start the daemon
lark-codewhale-bridge stop                  Stop the daemon and disable autostart
lark-codewhale-bridge restart               Restart the daemon in place
lark-codewhale-bridge status                Show daemon status
lark-codewhale-bridge unregister            Remove the service definition and stop
```

## Architecture

```
Feishu/Lark App ←WebSocket→ lark-codewhale-bridge → codewhale exec --auto --output-format stream-json
```

### Why Codewhale?

Codewhale is a terminal-native AI coding agent (powered by DeepSeek). This bridge exposes it through Feishu/Lark, giving you a chat-based coding assistant that can read files, edit code, run commands, and maintain session context — all from within Lark.

## Multi-Agent Architecture

The bridge supports multiple concurrent Codewhale sessions. A Feishu chat is the project boundary and owns one cwd. Threads/topics inside that chat are session boundaries, so starting a new thread does not disturb another thread's Codewhale history.

When `lark-cli` is installed and bound, every prompt includes a small Lark capability header with the current `chat_id`, optional `thread_id`, project scope, and session scope. Codewhale is instructed to operate only in the current chat/thread unless an admin explicitly asks for cross-chat output. Set `LARK_CODEWHALE_DISABLE_CAPABILITY_PROMPT=1` to disable this injected guidance.

## Access control

Use the `/config` command to open the configuration card. Access control supports three dimensions:

- **Allowed users**: only listed `open_id` users can talk to the bot.
- **Allowed chats**: only listed `chat_id` groups can trigger responses. Direct messages are unaffected.
- **Admins**: only admins can run management commands such as `/config`, `/account`, and `/exit`.

## License

MIT
