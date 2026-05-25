# lark-codewhale-bridge

把飞书 / Lark 消息和本地 Codewhale CLI 打通的轻量 bot。一条命令起服务，扫码绑应用，在飞书里和 Codewhale 对话、让它读图 / 改代码。

[English README](./README.md)

## 功能

- 飞书 / Lark 消息（私聊或群聊 `@bot`）转发到本地 `codewhale` CLI
- **流式卡片**：Codewhale 的文字和工具调用实时更新在同一张飞书卡片上
- **项目 + thread 会话**：一个飞书聊天 = 一个项目 cwd；每个 thread / 话题 = 一个独立 Codewhale session
- **抢占 + 批处理**：新消息打断当前 run；快速连发合并为一次请求
- **多工作空间**：`/ws` 切换项目目录
- **图片和文件**：直接发给 bot，Codewhale 读取本地下载路径
- **富表达**：绑定 `lark-cli` 后，Codewhale 可以把富文本、表格、图片/文件、交互卡片、飞书 Docx 链接发回当前 chat/thread
- **交互卡片**：`/help`、`/status` 等命令返回可点击的飞书卡片；Codewhale 自己发出的卡片按钮也能回到同一个 session
- **飞书文档流**：`/doc <需求>` 和 `/spec <需求>` 会让 Codewhale 创建/更新飞书 Docx 并把链接发回来

## 安装

```bash
npm i -g lark-codewhale-bridge
# 或
pnpm add -g lark-codewhale-bridge
```

## 首次运行

```bash
lark-codewhale-bridge run
```

首次启动时没有配置，会自动打开二维码向导：

1. 终端显示二维码
2. 用飞书 / Lark 扫码
3. 选择或创建 PersonalAgent 应用
4. 凭据写入 `~/.lark-codewhale/config.json`

## 命令

### 飞书 / Lark 聊天内命令

```
/new | /reset                        在当前 chat/thread 开新 session
/new chat [名字]                     新建群，并继承当前项目 cwd
/resume [N]                          恢复最近的 Codewhale session
/status                              查看项目 cwd、session scope 和 agent 状态
/cd <路径>                           切换当前飞书聊天的项目 cwd
/ws list|save|use|remove             管理命名工作空间
/doc <需求> | /spec <需求>            创建/更新飞书 Docx，并把链接发回当前会话
/stop                                停止当前 run
/timeout [N|off|default]             覆盖当前 session 的 idle timeout
/config | /account | /doctor         配置、切换应用凭据、自助诊断
/ps | /exit <id|#> | /reconnect      管理本机 bridge 进程
```

`/doc` 和 `/spec` 面向普通允许用户开放；`/config`、`/account`、`/doctor`、`/cd`、`/ws`、`/exit`、`/reconnect` 仍按管理员名单限制。

### 进程级别命令

```
lark-codewhale-bridge run [-c <config>]     前台运行
lark-codewhale-bridge ps                     查看正在运行的进程
lark-codewhale-bridge kill <id|#>            杀掉进程
lark-codewhale-bridge --help                 所有命令
```

### 服务级别命令（launchd / systemd / schtasks）

> ⚠️ **使用服务级命令前请先全局安装。** daemon 的 launchd plist / systemd unit / Windows task 会固定写入 bridge CLI 的路径。先执行 `npm install -g lark-codewhale-bridge`。

```
lark-codewhale-bridge start                  安装并启动后台服务
lark-codewhale-bridge stop                   停止后台服务
lark-codewhale-bridge restart                重启后台服务
lark-codewhale-bridge status                 查看服务状态
lark-codewhale-bridge unregister             移除服务定义
```

## 架构

```
飞书/Lark 应用 ←WebSocket→ lark-codewhale-bridge → codewhale exec --auto --output-format stream-json
```

聊天维度是项目边界，cwd 跟随 `chat_id`；thread / 话题维度是会话边界，session 跟随 `chat_id:thread_id`。这样同一个群内不同 thread 可以独立推进任务，但共享同一个项目目录。

绑定 `lark-cli` 后，bridge 会在 prompt 里注入当前 `chat_id`、可选 `thread_id`、project scope、session scope 和飞书能力说明，要求 Codewhale 只向当前 chat/thread 输出。需要关闭这段能力提示时，可设置 `LARK_CODEWHALE_DISABLE_CAPABILITY_PROMPT=1`。

## 访问控制

使用 `/config` 命令打开配置卡。访问控制支持三个维度：

- **允许的用户**：只允许指定 `open_id` 的用户对话
- **允许的群聊**：只允许指定 `chat_id` 的群触发响应（私聊不受限）
- **管理员**：只有管理员能运行 `/config`、`/account`、`/exit` 等管理命令

## License

MIT
