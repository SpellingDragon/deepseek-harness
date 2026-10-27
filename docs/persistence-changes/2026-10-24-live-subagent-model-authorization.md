---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-24-live-subagent-model-authorization

English | [中文](2026-10-24-live-subagent-model-authorization.zh.md)

## Summary

Adds subagent/model-selection-policy-change and optional per-route default reasoning effort and context-window overrides on the subagent model-authorization events.

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
    after: "c44f40f7bb4c8c5ca95020d92993e2a72836fdcbc74512d2a0f748c372929984"
    decision: same-version
  - root: "event:subagent/model-selection-policy-change"
    previous: null
    after: "47fc1fee10b0f02821d2abf2dd3965f039827887366cbc12a2b7e5d4de6b7556"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing logs without a change event or route effort/window keep their current meaning: the initial policy event remains authoritative and an omitted effort or window leaves the adapter default in charge. New readers fold the latest change event and apply a route's optional default effort and context-window override only when the child has no explicit value. Readers that meet the new required policy-change event, or the optional reasoningEffort/contextWindow fields inside an existing policy event, refuse to reconstruct that Session instead of silently applying stale authorization; no downgrade support is provided. The Session format version stays unchanged because the new discriminator and optional properties are distinguishable.

<a id="verification"></a>
## Verification

corepack pnpm exec vitest run packages/subagent/tool-subagent/tests --coverage --coverage.include='packages/subagent/tool-subagent/src/**/*.ts': 8 files, 171 tests passed; 100% statements, branches, functions, and lines for the package sources. The projection and settings cases cover initial, enabled, disabled, malformed, live update, restore, unchanged-route, per-route effort and context-window folding, discovery, and executor-denial folding.

<a id="dev-note"></a>
## Dev Note

None.
