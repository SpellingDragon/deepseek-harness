# Agent Note: Live subagent model authorization updates

Status: implemented

English | [中文](2026-10-24-live-subagent-model-authorization.zh.md)

## Problem

The Host records a Session's authorized subagent routes before its first model request. A settings edit therefore affected only Sessions created afterwards; a running or restored Session kept its creation-time authorization until the user started a new conversation. The durable snapshot kept resume deterministic, but it made an explicit user preference appear ineffective in the conversation the user was already having. The same settings card had no per-model way to set a default reasoning effort or context window, so an omitted effort or capacity always fell back to the adapter's metadata.

## Decision

`subagent/model-selection-policy-change` records a live authorization change with an `enabled` flag and the currently saved exact routes. The existing `subagent/model-selection-policy` event remains the initial startup record. The Session projection folds both event types and exposes the latest authorization; a disabled change clears authorization without discarding the routes retained by the settings document. The projection state version advances because its fold semantics changed.

The Host settings service writes the change event to every live Agent when the Volatile preference updates. On Agent creation it compares the recorded authorization with the current preference: a fresh startup Session receives the initial event when authorization differs, while a restored Session receives a change event. New Sessions, including child Sessions, take the current host preference rather than inheriting a parent snapshot. A change event is appended only when the route set differs; list order alone is not a change.

Each authorized route also carries an optional default `reasoningEffort` and `contextWindow`. When a delegation call omits `reasoning_effort` and its effective route matches an authorized route, the executor uses that route's default effort; an explicit model value still wins. The context window is copied into the child's `AgentOptions` and used as a live `Agent.contextWindow` override for request metadata and compaction. Top-level Agents are excluded. A settings change updates live child Agents in place, so their next request or compaction pass uses the new capacity without recreating the Agent. This is a default/budget override, not an allowlist: every effort the adapter advertises for the route remains selectable, and the adapter still enforces its own request limits.

Discovery and delegation continue to read the Session projection. They do not read the settings document on each call, so every authority change remains in the Session log and a restored Session replays the same sequence of decisions. Settings, discovery, and execution still share one package-local authorization definition.

## Alternatives considered

**Read current settings on every discovery or delegation call.** Rejected because the authority a Session used would depend on ambient process state rather than its durable log. The earlier rejection of this design remains: live updates are recorded decisions, not per-call settings reads.

**Append an empty `allowedModels` array to the existing event and treat it as disabled.** Rejected because it reuses a discriminator with a new meaning and makes existing readers reject or misinterpret a valid log. A distinct event lets existing logs and existing readers keep their established behavior.

**Store a per-route reasoning-effort allowlist.** Rejected because the user decision concerns child models, while effort ids and compatibility belong to the exact adapter route. The optional route effort records a default only; it does not narrow the efforts the model may explicitly select.

**Set only the provider model's global context window.** Rejected because that changes every Agent on the route, including the top-level Agent the user is talking to. The subagent setting is an independent child-only override.

**Recreate child Agents when the context window changes.** Rejected because it would discard their working conversation and in-flight ownership. The live `Agent.contextWindow` override updates the existing Agent for its next request or compaction pass.

**Update only the Session that saved the settings change.** Rejected because the preference is host-scoped; other live Sessions and their children would keep stale authority. All live Agents are reconciled together.

**Update children on the next delegation only.** Rejected because a child can itself delegate, and a narrowed preference must apply to every Agent before its next child is started. The settings service updates each live Agent's own Session.

**Keep creation-time snapshots and require a new conversation.** Rejected because it leaves the reported preference change ineffective for the conversation and for restored Sessions, which is the behavior this decision removes.

## Consequences

- A settings edit changes the authority of every live Agent, including child Agents, and a restored Session is reconciled before its first new request. The change is visible to the next discovery or delegation call and is recorded in that Session's log.
- The initial event remains unchanged for compatibility. Change events append only when the exact route set, a route's default effort, or a route's context window differs; reordering the same routes appends nothing.
- A route's default effort is applied only when the caller omits an effort. The settings card offers the adapter's advertised efforts per selected model; an explicit call value remains unrestricted by the policy.
- A route's context window is a child-only budget override. It is logged in `request/context` and consumed by compaction; it does not enlarge the adapter's actual capacity, so an override above the adapter limit can still fail at request time. Top-level Agents keep adapter metadata.
- Live child Agents receive the current override on creation, model changes, resume, and settings changes; no process restart is required. Removing a route's window returns the child to adapter metadata; disabling model selection or removing the route leaves a running child's current window unchanged.
- An older harness version meeting the new required event refuses to reconstruct that Session instead of silently applying stale authority. No downgrade support is provided. New readers preserve old logs because an absent change event leaves the initial event authoritative.
- Discovery and execution keep reading the shared projection, so the authorization path has one source and one enforcement point.
- Tests cover live top-level and child updates, restored Sessions, unchanged route sets, per-route default-effort and context-window changes, discovery results, executor denial, and compaction using the live override.

## Related decisions

The settings namespace, explicit allowlist, discovery contract, and executor enforcement remain owned by [user-authorized subagent model routes](2026-08-24-user-authorized-subagent-model-routes.md). This note changes that decision's propagation consequence; its rejection of per-call settings reads remains in force.
