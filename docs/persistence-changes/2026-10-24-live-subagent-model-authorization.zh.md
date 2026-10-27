---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-24-live-subagent-model-authorization

[English](2026-10-24-live-subagent-model-authorization.md) | 中文

## 概述

新增 subagent/model-selection-policy-change 事件，并为 subagent 模型授权事件增加可选的每路由默认推理强度和上下文窗口覆盖。

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
  - root: "event:subagent/model-selection-policy"
    previous: "2026-09-11-initial"
    after: "c44f40f7bb4c8c5ca95020d92993e2a72836fdcbc74512d2a0f748c372929984"
    decision: same-version
  - root: "event:subagent/model-selection-policy-change"
    previous: null
    after: "47fc1fee10b0f02821d2abf2dd3965f039827887366cbc12a2b7e5d4de6b7556"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

没有变更事件或路由强度/窗口的已有日志保持现有含义：初始策略事件仍是权威来源，省略强度或窗口时仍由适配器默认值决定。新读取方折叠最新的变更事件，并在调用方省略强度时应用路由的可选默认强度；可选的上下文窗口覆盖由 Host 设置所有者应用到存活的子 Agent。旧读取方遇到新的必需策略变更事件，或既有策略事件中的可选 reasoningEffort/contextWindow 字段时，会拒绝重建该 Session，而不是静默沿用过期授权；不提供降级支持。Session 格式版本保持不变，因为新判别值和可选属性都可区分。

<a id="verification"></a>
## 验证

corepack pnpm exec vitest run packages/subagent/tool-subagent/tests --coverage --coverage.include='packages/subagent/tool-subagent/src/**/*.ts'：8 个文件，171 个测试通过；包源码的语句、分支、函数和行覆盖率均为 100%。投影与设置用例覆盖初始、启用、关闭、异常、实时更新、恢复、路由集合未变、每路由强度与上下文窗口、发现与执行器拒绝的折叠。

<a id="dev-note"></a>
## 开发备注

无。
