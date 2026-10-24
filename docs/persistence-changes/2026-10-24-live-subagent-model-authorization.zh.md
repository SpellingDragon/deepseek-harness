---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-24-live-subagent-model-authorization

[English](2026-10-24-live-subagent-model-authorization.md) | 中文

## 概述

新增 subagent/model-selection-policy-change 事件，并为 subagent 模型授权事件增加可选的每路由默认推理强度。

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
    after: "98e89a830ffa3b081bf182a26850c270550dc467d734b37f6739295a166aae3b"
    decision: same-version
  - root: "event:subagent/model-selection-policy-change"
    previous: null
    after: "59e286f8fc30e06cc037ccd3644f88f08035edc879cdb1c6115471b4352e6a5e"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

没有变更事件或路由强度的已有日志保持现有含义：初始策略事件仍是权威来源，省略强度时仍由适配器默认值决定。新读取方折叠最新的变更事件，并仅在调用方省略强度时应用路由的可选默认强度。旧读取方遇到新的必需策略变更事件，或既有策略事件中的可选 reasoningEffort 字段时，会拒绝重建该 Session，而不是静默沿用过期授权；不提供降级支持。Session 格式版本保持不变，因为新判别值和可选属性都可区分。

<a id="verification"></a>
## 验证

corepack pnpm exec vitest run packages/subagent/tool-subagent/tests --coverage --coverage.include='packages/subagent/tool-subagent/src/**/*.ts'：8 个文件，168 个测试通过；包源码的语句、分支、函数和行覆盖率均为 100%。投影与设置用例覆盖初始、启用、关闭、异常、实时更新、恢复、路由集合未变、每路由强度、发现与执行器拒绝的折叠。

<a id="dev-note"></a>
## 开发备注

无。
