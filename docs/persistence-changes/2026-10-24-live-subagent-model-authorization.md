---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-24-live-subagent-model-authorization

English | [中文](2026-10-24-live-subagent-model-authorization.zh.md)

## Summary

Extends the subagent model-authorization events so one authorized route may be marked as the delegation default. A delegation that selects no route resolves that route and its authorized reasoning effort; the settings card can move or clear the mark, and the policy-change event carries it to live Sessions.

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
    after: "569563b018835e438b9cc0ec6636cd706ab3f62f764e3e1cac4a205851bfa69f"
    decision: same-version
  - root: "event:subagent/model-selection-policy-change"
    previous: null
    after: "d0edf7c555f57803e455504655902f83c697d2e2431d5b0431ce10cac9365551"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing logs without the change event or the route’s optional effort, window, or default marker keep their current meaning: the initial policy event remains authoritative, an omitted effort or window leaves the adapter or child default in charge, and no route is treated as the delegation default. New readers fold the latest change event, apply a route’s default effort when the caller omits one, and resolve a marked default route for delegations that select none. Readers that meet the new required policy-change event, or the optional `reasoningEffort`, `contextWindow`, or `default` properties inside an existing policy event, refuse to reconstruct that Session instead of silently applying stale authorization; no downgrade support is provided. The Session format version stays unchanged because the new discriminator and optional properties are distinguishable.

<a id="verification"></a>
## Verification

Focused runs: packages/subagent/tool-subagent/tests — 8 files, 181 tests passed, 100% statements, branches, functions, and lines for the package sources; packages/client/ui-settings-subagent/tests — 3 files, 55 tests passed, 100% for src/client. Cases cover default-route resolution and precedence, the live policy-change marker, projection folding, and staged marker edits in the card.

<a id="dev-note"></a>
## Dev Note

None.
