---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-24-live-subagent-model-authorization

English | [中文](2026-10-24-live-subagent-model-authorization.zh.md)

## Summary

Adds subagent/model-selection-policy-change and an optional per-route default reasoning effort on the subagent model-authorization events.

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
## Compatibility

Existing logs without a change event or route effort keep their current meaning: the initial policy event remains authoritative and an omitted effort leaves the adapter default in charge. New readers fold the latest change event and apply a route's optional default effort only when the caller omits one. Readers that meet the new required policy-change event, or the optional reasoningEffort field inside an existing policy event, refuse to reconstruct that Session instead of silently applying stale authorization; no downgrade support is provided. The Session format version stays unchanged because the new discriminator and optional property are distinguishable.

<a id="verification"></a>
## Verification

corepack pnpm exec vitest run packages/subagent/tool-subagent/tests --coverage --coverage.include='packages/subagent/tool-subagent/src/**/*.ts': 8 files, 168 tests passed; 100% statements, branches, functions, and lines for the package sources. The projection and settings cases cover initial, enabled, disabled, malformed, live update, restore, unchanged-route, per-route effort, discovery, and executor-denial folding.

<a id="dev-note"></a>
## Dev Note

None.
