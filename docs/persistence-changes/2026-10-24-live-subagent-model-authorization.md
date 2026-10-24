---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-24-live-subagent-model-authorization

English | [中文](2026-10-24-live-subagent-model-authorization.zh.md)

## Summary

Adds subagent/model-selection-policy-change, a required Session event that records live subagent model-authorization changes.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing logs keep their current meaning: when no change event is present, subagent/model-selection-policy remains authoritative, and new readers preserve that behavior. New readers fold the latest change event; a disabled change clears authorization while retaining the saved routes for audit. Older readers meeting the new required event refuse to reconstruct that Session instead of silently applying the stale authorization, so no downgrade support is provided. The Session format version stays unchanged because the new discriminator cannot be interpreted as an existing event.

<a id="verification"></a>
## Verification

corepack pnpm exec vitest run packages/subagent/tool-subagent/tests --coverage --coverage.include='packages/subagent/tool-subagent/src/**/*.ts': 8 files, 164 tests passed; 100% statements, branches, functions, and lines for the package sources. The projection and settings cases cover initial, enabled, disabled, malformed, live update, restore, unchanged-route, discovery, and executor-denial folding.

<a id="dev-note"></a>
## Dev Note

None.
