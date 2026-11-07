# Codex + 飞书，无 OpenViking 实验分支

此分支基于 `feat/vika` 的 `9b8557d`，仅用于测试其他上下文方案，不提交主线 PR。它不是官方支持的 Vika 安装模式，也不是 Windows 分支。

## 行为

- setup 不探测 OV、不要求 OV 配置、不建立 OV 用户。
- daemon 不建立 OV 客户端、不上传会话、不读历史、不自动召回。
- 新 Codex 原生会话从空历史开始；同一个原生会话仍由 Codex 自己管理和恢复。`/new` 后不会从本地消息账本补历史。
- Core 不提供 OV 历史读取工具，提示词不再要求使用 OV 长期记忆。
- Codex 启动参数禁用名为 `openviking` 的用户 MCP 服务。用户另行配置的 MCP、上下文工具或自定义命名的 OV 服务不由本分支管理。必须自行检查 Codex 配置，才能保证测试环境没有其他 OV 接入。
- 清除继承的 `OPENVIKING_*` 配置，仅传入关闭插件自动记忆的开关；不修改用户全局 Codex 配置文件。
- 本地定时器使用 SQLite。setup 不启动自动更新器，避免切回要求 OV 的官方版。
- 主要验证对象为 Codex + 飞书。邮件附件归档、会议纪要归档等 OV 依赖能力不在此实验的支持范围内。

## 从源码安装（macOS / Linux）

需要 Git、Node.js 24（最低 22.19）、npm，以及已安装并完成登录的本机 Codex CLI。需要可用的飞书机器人配置权限；setup 可扫码或填写应用凭据。

在没有既有 Vika 部署的用户环境中操作。已有 Vika 时不要把此流程覆盖到原来的 `~/.vika`，应使用独立系统用户或独立测试机器；同一个飞书机器人也不要被两套进程同时监听。不要改动现有生产实例。

```bash
git clone --single-branch --branch experiment/codex-without-ov \
  https://github.com/openviking-superagent/OpenViking.git vika-no-ov
cd vika-no-ov/vika
node --version
codex --version
npm run setup
```

`npm run setup` 在这里安装源码依赖和所需 CLI；它不是交互式机器人配置。源码为 JavaScript，不需要编译发行包，也不运行官方 `install.sh`。

指定当前源码目录为启动目标，然后进入机器人配置：

```bash
export VIKA_UPDATER_RELEASE_LINK="$PWD"
node packages/cli/bin/vika.mjs setup
```

选择 Codex、自己的工作目录、飞书。配置过程中没有 OV 步骤。模型及其他上下文方案由本机 Codex 自己的配置提供。首次实验不启用开机自启动。

之后在同一源码目录管理实例：

```bash
export VIKA_UPDATER_RELEASE_LINK="$PWD"
node packages/cli/bin/vika.mjs status
node packages/cli/bin/vika.mjs logs primary
node packages/cli/bin/vika.mjs restart primary
node packages/cli/bin/vika.mjs stop primary
```

每次换终端后重新设置上述环境变量。不要使用 `vika upgrade`，不要启动 updater，也不要使用没有目标名的批量启动命令。更新实验代码时先查看改动，再 `git pull --ff-only`、`npm run setup`，然后只重启自己的测试实例。

## 验收

1. 不安装、不启动 OV，完成首次 setup；确认没有 OV 连接提示或探测请求。
2. 飞书私聊发消息，确认 Codex 回复；让它在测试工作区写一个无敏感内容的文件并核对。
3. 让 Agent 列出可用工具，确认没有 `read_openviking_session_context` 和 OV MCP 工具；同时确认自己的上下文方案仍可用。
4. 在网络日志中确认没有 OV 请求。工具列表检查本身不能证明没有隐藏 hook 请求。
5. 同一会话继续提问、重启测试实例后继续提问；原生 Codex session 的恢复行为应保留。
6. `/new` 后不应通过 Vika 注入旧历史。如果仍出现记忆，检查用户自己的上下文方案或 Codex 原生功能。
7. 检查本机原来直接运行的 Codex 配置没有被修改。

## 验证边界

自动化覆盖无 OV setup、daemon 启动和消息输入、OV 工具隐藏、空历史及提示词。另运行 Codex、Core actions、cognition 回归测试。未使用真实飞书账号与真实模型完成端到端验收；需要安装者执行上述步骤。

原主线关于“OV 必需”的旧测试与文档仍描述主线行为，不作为本实验模式的验收规范。以本文件和 `no-ov.test.mjs` 为准。
