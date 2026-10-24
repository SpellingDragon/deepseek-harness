# Agent Note: Live subagent model authorization updates

Status: implemented

English | [中文](2026-10-24-live-subagent-model-authorization.zh.md)

## Problem

The Host records a Session's authorized subagent routes before its first model request. A settings edit therefore affected only Sessions created afterwards; a running or restored Session kept its creation-time authorization until the user started a new conversation. The durable snapshot kept resume deterministic, but it made an explicit user preference appear ineffective in the conversation the user was already having.

## Decision

`subagent/model-selection-policy-change` records a live authorization change with an `enabled` flag and the currently saved exact routes. The existing `subagent/model-selection-policy` event remains the initial startup record. The Session projection folds both event types and exposes the latest authorization; a disabled change clears authorization without discarding the routes retained by the settings document. The projection state version advances because its fold semantics changed.

The Host settings service writes the change event to every live Agent when the Volatile preference updates. On Agent creation it compares the recorded authorization with the current preference: a fresh startup Session receives the initial event when authorization differs, while a restored Session receives a change event. New Sessions, including child Sessions, take the current host preference rather than inheriting a parent snapshot. A change event is appended only when the route set differs; list order alone is not a change.

Discovery and delegation continue to read the Session projection. They do not read the settings document on each call, so every authority change remains in the Session log and a restored Session replays the same sequence of decisions. Settings, discovery, and execution still share one package-local authorization definition.

## Alternatives considered

**Read current settings on every discovery or delegation call.** Rejected because the authority a Session used would depend on ambient process state rather than its durable log. The earlier rejection of this design remains: live updates are recorded decisions, not per-call settings reads.

**Append an empty `allowedModels` array to the existing event and treat it as disabled.** Rejected because it reuses a discriminator with a new meaning and makes existing readers reject or misinterpret a valid log. A distinct event lets existing logs and existing readers keep their established behavior.

**Update only the Session that saved the settings change.** Rejected because the preference is host-scoped; other live Sessions and their children would keep stale authority. All live Agents are reconciled together.

**Update children on the next delegation only.** Rejected because a child can itself delegate, and a narrowed preference must apply to every Agent before its next child is started. The settings service updates each live Agent's own Session.

**Keep creation-time snapshots and require a new conversation.** Rejected because it leaves the reported preference change ineffective for the conversation and for restored Sessions, which is the behavior this decision removes.

## Consequences

- A settings edit changes the authority of every live Agent, including child Agents, and a restored Session is reconciled before its first new request. The change is visible to the next discovery or delegation call and is recorded in that Session's log.
- The initial event remains unchanged for compatibility. Change events append only when the exact route set differs; reordering the same routes appends nothing.
- An older harness version meeting the new required event refuses to reconstruct that Session instead of silently applying stale authority. No downgrade support is provided. New readers preserve old logs because an absent change event leaves the initial event authoritative.
- Discovery and execution keep reading the shared projection, so the authorization path has one source and one enforcement point.
- Tests cover live top-level and child updates, restored Sessions, unchanged route sets, discovery results, and executor denial after a preference change.

## Related decisions

The settings namespace, explicit allowlist, discovery contract, and executor enforcement remain owned by [user-authorized subagent model routes](2026-08-24-user-authorized-subagent-model-routes.md). This note changes that decision's propagation consequence; its rejection of per-call settings reads remains in force.
