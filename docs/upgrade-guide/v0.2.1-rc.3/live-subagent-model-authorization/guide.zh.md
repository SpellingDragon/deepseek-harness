---
kind: upgrade-guide
description: 子智能体模型选择设置现在会应用于运行中和恢复的 Session，受影响的日志会包含旧版 harness 无法读取的策略变更事件。
---

# 实时 subagent 模型授权

[English](guide.md) | 中文

## 变更

保存子智能体模型选择设置现在会更新所有运行中的 Session（包括子 Session）以及此后恢复的 Session。此前只有保存后创建的 Session 使用新授权。每个获准模型还可以携带一个可选的默认推理强度和一个仅作用于子级的上下文窗口覆盖。Session 日志现在可能包含 `subagent/model-selection-policy-change` 和 `agent/context-window` 事件，以及带 `reasoningEffort` 或 `contextWindow` 的授权路由。

旧版 harness 不认识这个必需事件或路由强度/上下文窗口字段，会拒绝打开受影响的 Session。不提供降级支持。

## 迁移

1. 在更改模型选择前，升级所有共享同一 Session 存储的 harness 进程。
2. 保持运行或恢复原 Session，不需要新建对话。它下一次 `list_subagent_models` 或 `subagent` 调用会使用当前授权。
3. 通过下一次发现结果，或在 Session 日志中找到 `subagent/model-selection-policy-change`，确认变更生效。
4. 如需回退，请保留更改设置前的 Session 日志备份，或继续使用新版 harness。旧版 harness 无法恢复包含新事件的日志。
