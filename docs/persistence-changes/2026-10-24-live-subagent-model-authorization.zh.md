---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-24-live-subagent-model-authorization

[English](2026-10-24-live-subagent-model-authorization.md) | 中文

## 概述

新增 subagent/model-selection-policy-change 必需 Session 事件，用于记录实时的 subagent 模型授权变更。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-24-live-subagent-model-authorization
baseline: false
changes:
  - root: "event:subagent/model-selection-policy-change"
    previous: null
    after: "b9f6114f9ef2c1499609aa8b3b253576726ac98ee9e96403f36a2c6db7984e58"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有日志保持现有含义：没有变更事件时，subagent/model-selection-policy 仍是权威来源，新读取方保留该行为。新读取方折叠最新的变更事件；关闭变更会清除授权，同时保留已保存路由供审计。旧读取方遇到新的必需事件时会拒绝重建该 Session，而不是静默沿用过期授权，因此不提供降级支持。Session 格式版本保持不变，因为新判别值无法被解释为既有事件。

<a id="verification"></a>
## 验证

corepack pnpm exec vitest run packages/subagent/tool-subagent/tests --coverage --coverage.include='packages/subagent/tool-subagent/src/**/*.ts'：8 个文件，164 个测试通过；包源码的语句、分支、函数和行覆盖率均为 100%。投影与设置用例覆盖初始、启用、关闭、异常、实时更新、恢复、路由集合未变、发现与执行器拒绝的折叠。

<a id="dev-note"></a>
## 开发备注

无。
