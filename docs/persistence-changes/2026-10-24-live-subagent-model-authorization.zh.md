---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-24-live-subagent-model-authorization

[English](2026-10-24-live-subagent-model-authorization.md) | 中文

## 概述

扩展 subagent 模型授权事件，使至多一条获准路由可标记为委派默认路由。未选择路由的委派会解析该路由及其获准推理强度；设置卡可移动或清除该标记，策略变更事件把它传播到存活 Session。

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
    after: "569563b018835e438b9cc0ec6636cd706ab3f62f764e3e1cac4a205851bfa69f"
    decision: same-version
  - root: "event:subagent/model-selection-policy-change"
    previous: null
    after: "d0edf7c555f57803e455504655902f83c697d2e2431d5b0431ce10cac9365551"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

没有变更事件或路由可选强度、窗口与默认标记的已有日志保持现有含义：初始策略事件仍然是权威来源，省略强度或窗口时由适配器或子级默认值决定，且没有任何路由被视为委派默认。新读取方折叠最新的变更事件，在调用方省略强度时应用路由默认强度，并为未选择路由的委派解析被标记的默认路由。遇到新的必需策略变更事件，或已有策略事件中的可选 `reasoningEffort`、`contextWindow`、`default` 属性时，旧读取方会拒绝重建该 Session，而不是静默沿用过期授权；不提供降级支持。Session 格式版本保持不变，因为新判别值与可选属性均可区分。

<a id="verification"></a>
## 验证

重点运行：packages/subagent/tool-subagent/tests —— 8 个文件、181 项测试通过，包源码语句、分支、函数与行覆盖率 100%；packages/client/ui-settings-subagent/tests —— 3 个文件、55 项测试通过，src/client 覆盖率 100%。用例覆盖默认路由解析与优先级、实时策略变更标记、投影折叠，以及设置卡中的标记暂存编辑。

<a id="dev-note"></a>
## 开发备注

无。
