# lark-codewhale-bridge

把飞书 / Lark 和本地 [Codewhale](https://github.com/Hmbown/CodeWhale) CLI 编程 agent 打通的轻量 bot。一条命令起服务，扫码绑应用，在飞书里直接和 AI 编程 agent 对话——改代码、读文件、跑命令，全在聊天里。

```
飞书/Lark App ←WebSocket→ lark-codewhale-bridge → codewhale exec --auto
```

## 前置要求

- **Node.js >= 20**
- **安装并登录 Codewhale CLI** — 参考 [CodeWhale](https://github.com/Hmbown/CodeWhale)
- **飞书 / Lark PersonalAgent 应用**（首次启动的二维码向导可以帮你创建）

## 安装

```bash
npm install -g lark-codewhale-bridge
# 或
pnpm add -g lark-codewhale-bridge
```

## 快速开始

```bash
lark-codewhale-bridge run
```

首次启动会自动打开二维码注册向导：

1. 终端显示二维码
2. 用飞书 / Lark 扫码
3. 选择或创建 PersonalAgent 应用
4. 凭据写入 `~/.lark-codewhale/config.json`

Bot 启动后，直接给它发私信，或在群里 `@bot` 开始对话。

## 使用

### 聊天内命令

| 命令 | 说明 |
|------|------|
| `/new` 或 `/reset` | 在当前 chat/thread 开启新 session |
| `/new chat [名称]` | 新建群，继承当前项目 cwd |
| `/resume [N]` | 查看/恢复最近 Codewhale session |
| `/status` | 查看 cwd、session scope、agent 状态 |
| `/cd <路径>` | 切换当前聊天的项目目录 |
| `/ws list\|save\|use\|remove` | 管理命名工作空间 |
| `/doc <需求>` / `/spec <需求>` | 让 Codewhale 创建/更新飞书 Docx |
| `/stop` | 停止当前 run |
| `/timeout [N\|off\|default]` | 覆盖当前 session 的空闲超时 |
| `/config` | 打开偏好设置表单卡片 |
| `/account` | 查看/切换应用凭据 |
| `/doctor [描述]` | 自助诊断 — 把近期日志交给 Codewhale 分析 |
| `/ps` | 查看运行中的 bridge 进程 |
| `/exit <id\|#>` | 杀掉 bridge 进程 |
| `/reconnect` | 强制重连 WebSocket |
| `/help` | 帮助卡片 |

### CLI 命令（终端）

**前台运行：**

| 命令 | 说明 |
|------|------|
| `lark-codewhale-bridge run` | 前台启动 bot |
| `lark-codewhale-bridge run -c <路径>` | 使用自定义配置 |
| `lark-codewhale-bridge run --skip-check-lark-cli` | 跳过 lark-cli 检查 |
| `lark-codewhale-bridge ps` | 列出运行中的 bridge 进程 |
| `lark-codewhale-bridge kill <id\|#>` | 杀掉进程 |

**后台 daemon 服务：** 支持 macOS (launchd)、Linux (systemd)、Windows (Task Scheduler)。

```bash
# 先全局安装
npm install -g lark-codewhale-bridge

lark-codewhale-bridge start        # 安装并启动后台服务
lark-codewhale-bridge stop         # 停止
lark-codewhale-bridge restart      # 重启
lark-codewhale-bridge status       # 查看状态
lark-codewhale-bridge unregister   # 移除服务
```

**凭据管理：**

```bash
lark-codewhale-bridge secrets set --app-id <id>      # 加密存储 App Secret
lark-codewhale-bridge secrets get                    # exec-provider 协议（供 lark-cli 使用）
lark-codewhale-bridge secrets list                   # 列出已存储的 secret ID
lark-codewhale-bridge secrets remove --app-id <id>   # 删除存储的 secret
```

## 配置

配置文件位于 `~/.lark-codewhale/config.json`（首次运行时自动创建）。

### 偏好设置（通过 `/config` 命令设置）

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `messageReply` | `markdown` | 回复格式：`card` / `markdown` / `text` |
| `showToolCalls` | `true` | 是否展示工具调用 |
| `maxConcurrentRuns` | `10` | 最大并发 run 数（上限 50） |
| `runIdleTimeoutMinutes` | — | 空闲 N 分钟后自动停止（0=关闭，1-120） |
| `requireMentionInGroup` | `true` | 群聊中是否需要 `@bot` 才响应 |
| `agentStopGraceMs` | `5000` | SIGTERM → SIGKILL 等待时间（毫秒） |

### 环境变量

| 变量 | 说明 |
|------|------|
| `HTTPS_PROXY` / `HTTP_PROXY` | 飞书 API 和 WebSocket 的代理地址 |
| `LARK_CODEWHALE_LOG_DAYS` | 日志保留天数（默认 7） |
| `LARK_CODEWHALE_DISABLE_CAPABILITY_PROMPT` | 设为 `1` 可禁用 prompt 中的 Lark 能力描述 |

### 访问控制（通过 `/config` 设置）

- **允许的用户**：只允许指定 `open_id` 的用户对话（为空则全部允许）
- **允许的群聊**：只允许指定 `chat_id` 的群触发响应（私聊不受限）
- **管理员**：只有管理员能执行 `/config`、`/account`、`/exit`、`/ws`、`/cd`、`/doctor`、`/reconnect` 等管理命令

## 核心功能

- **流式卡片**：Codewhale 输出实时更新在同一张飞书卡片上
- **项目隔离**：每个聊天拥有独立的工作目录（cwd）
- **线程隔离**：每个 thread/话题拥有独立的 Codewhale session
- **抢占 + 批处理**：新消息打断当前 run；快速连发合并为一次请求
- **文件支持**：发送图片/文件给 bot，Codewhale 读取本地缓存路径
- **富表达**（绑定 `lark-cli` 后）：Codewhale 可发回表格、图片、交互卡片和 Docx 链接
- **交互卡片**：bot 回复中的按钮点击可路由回同一 session
- **飞书文档流**：`/doc`、`/spec` 命令让 Codewhale 创建/更新飞书 Docx

## License

MIT
