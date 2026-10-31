---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-31-agent-context-window

English | [中文](2026-10-31-agent-context-window.zh.md)

## Summary

Adds the required log-only agent/context-window Session event, recording a live positive context-window override or null to return to adapter metadata. The host agentContextWindow projection folds the latest event.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing logs without the event keep adapter metadata. New readers fold the latest event; readers that meet the unknown required event refuse to reconstruct the Session instead of silently ignoring a capacity change, and no downgrade support is provided. The Session format version stays unchanged because the new discriminator is distinguishable.

<a id="verification"></a>
## Verification

Focused coverage for core/agent context-window, agent-loop request reconstruction, compaction pressure, and subagent settings reached 100% statements, branches, functions, and lines for the changed packages; the live, cleared, restored, and request-recorded cases are covered.

<a id="dev-note"></a>
## Dev Note

None.
