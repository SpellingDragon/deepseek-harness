---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-31-agent-context-window

[English](2026-10-31-agent-context-window.md) | 中文

## 概述

新增必需的 log-only `agent/context-window` Session 事件，记录实时正数上下文窗口覆盖，或 `null` 回到适配器元数据。仅 Host 使用的 `agentContextWindow` 投影折叠最新事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-31-agent-context-window
baseline: false
changes:
  - root: "event:agent/context-window"
    previous: null
    after: "7148b9555004b630531bcd8ba17b9be2b0e4c0bc87dddfbeb640953cb8352fde"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

没有该事件的已有日志继续使用适配器元数据。新读取方折叠最新事件；遇到未知必需事件的旧读取方会拒绝重建该 Session，而不是静默忽略容量变化，且不提供降级支持。Session 格式版本保持不变，因为新判别值可区分。

<a id="verification"></a>
## 验证

core/agent context-window、agent-loop 请求重建、compaction 压力和 subagent 设置的重点覆盖率均达到语句、分支、函数和行 100%；覆盖实时、清除、恢复和请求记录场景。

<a id="dev-note"></a>
## 开发备注

无。
