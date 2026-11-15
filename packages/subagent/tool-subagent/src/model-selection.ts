/** Child LLM route selection for the subagent tool. */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/types'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import { SubagentError } from '@deepseek-ai/dsh-subagent'
import { ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** One exact child LLM route authorized by a user setting. */
export interface AllowedModelRoute {
  /** Registered LLM provider id. */
  readonly provider: string
  /** Provider-owned exact model id. */
  readonly model: string
  /** Adapter-owned effort used when a child selects this route without one. */
  readonly reasoningEffort?: string
  /** Context-window override for this child route; omission uses adapter metadata. */
  readonly contextWindow?: number
  /** Whether children use this route when the caller selects none; at most one route sets it. */
  readonly default?: boolean
}

/** Schema shared by the Host setting and its deployment base. */
export const AllowedModelRouteSchema: z<AllowedModelRoute> = z.object({
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
  reasoningEffort: z.string().min(1),
  contextWindow: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  default: z.boolean(),
})

/** Exact routes authorized for one Session. */
export interface ModelSelectionPolicy {
  /** Exact provider/model routes authorized for explicit selection. */
  readonly routes: readonly AllowedModelRoute[]
}

/**
 * Stable identity for one provider/model pair.
 * @param route - Exact provider/model route.
 * @returns Opaque key for equality checks.
 */
export function modelRouteKey(route: AllowedModelRoute): string {
  return `${route.provider}\0${route.model}`
}

/**
 * Compare two authorization lists without treating their order as meaningful.
 * Omitted and null lists both mean no policy. A route's default reasoning
 * effort is part of the policy because changing it changes the child request.
 * @param left - One route list or absence.
 * @param right - The other route list or absence.
 * @returns Whether both describe the same exact route policy.
 */
export function sameAllowedModelRoutes(
  left: readonly AllowedModelRoute[] | null | undefined,
  right: readonly AllowedModelRoute[] | null | undefined,
): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return (left ?? null) === (right ?? null)
  }
  if (left.length !== right.length) return false
  const policies = new Set(left.map(modelRoutePolicyKey))
  return right.every(route => policies.has(modelRoutePolicyKey(route)))
}

/**
 * Stable policy identity for one route, including its default effort, window,
 * and default-route marker.
 * @param route - Exact provider/model route and its optional defaults.
 * @returns Opaque key for policy equality checks.
 */
function modelRoutePolicyKey(route: AllowedModelRoute): string {
  return `${modelRouteKey(route)}\0${route.reasoningEffort ?? ''}\0${route.contextWindow ?? ''}\0${route.default === true ? '1' : '0'}`
}

/**
 * Find the authorized route matching one effective provider/model pair.
 * @param routes - Authorized exact routes.
 * @param provider - Effective provider id.
 * @param model - Effective model id.
 * @returns The matching route, or undefined when no route authorizes it.
 */
export function allowedRouteFor(
  routes: readonly AllowedModelRoute[],
  provider: string,
  model: string,
): AllowedModelRoute | undefined {
  return routes.find(route => route.provider === provider && route.model === model)
}

/**
 * Reject malformed or duplicate route policy entries at a durable or configuration boundary.
 * @param routes - Candidate exact routes to validate.
 * @returns an assertion that the candidate is a validated exact-route array.
 */
export function assertAllowedModelRoutes(routes: unknown): asserts routes is readonly AllowedModelRoute[] {
  if (!Array.isArray(routes)) {
    throw new Error('subagent model selection requires an array of routes')
  }
  const seen = new Set<string>()
  let defaults = 0
  const candidates: readonly unknown[] = routes
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)
      || !('provider' in candidate) || typeof candidate.provider !== 'string'
      || !('model' in candidate) || typeof candidate.model !== 'string'
      || candidate.provider.length === 0 || candidate.model.length === 0) {
      throw new Error('subagent model selection requires non-empty provider and model ids')
    }
    const reasoningEffort = 'reasoningEffort' in candidate ? candidate.reasoningEffort : undefined
    if (reasoningEffort !== undefined
      && (typeof reasoningEffort !== 'string' || reasoningEffort.length === 0)) {
      throw new Error('subagent model selection requires a non-empty reasoning effort when provided')
    }
    const contextWindow = 'contextWindow' in candidate ? candidate.contextWindow : undefined
    if (contextWindow !== undefined
      && (typeof contextWindow !== 'number' || !Number.isSafeInteger(contextWindow) || contextWindow <= 0)) {
      throw new Error('subagent model selection requires a positive safe-integer context window when provided')
    }
    const isDefault = 'default' in candidate ? candidate.default : undefined
    if (isDefault !== undefined && typeof isDefault !== 'boolean') {
      throw new Error('subagent model selection requires a boolean default marker when provided')
    }
    if (isDefault === true) defaults++
    if (defaults > 1) {
      throw new Error('subagent model selection allows at most one default route')
    }
    const route = {
      provider: candidate.provider,
      model: candidate.model,
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...isDefault === true ? { default: true } : {},
    }
    const key = modelRouteKey(route)
    if (seen.has(key)) {
      throw new Error(`subagent model selection repeats route "${route.provider}/${route.model}"`)
    }
    seen.add(key)
  }
}

/**
 * Resolve the route children use when the caller selects none.
 * @param routes - Authorized exact routes, or undefined without a policy.
 * @returns Child options for the single default route, or undefined when none is marked.
 */
export function defaultRouteChildOptions(
  routes: readonly AllowedModelRoute[] | undefined,
): AgentOptions | undefined {
  const route = routes?.find(candidate => candidate.default === true)
  if (route === undefined) return undefined
  return {
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: brandString<ReasoningEffortId>(route.reasoningEffort) },
  }
}

/** Model-facing child LLM route fields. */
export interface DelegationModelRequest {
  readonly provider?: string
  readonly model?: string
  readonly reasoning_effort?: string
}

/**
 * Whether a call explicitly selects any child LLM value.
 * @param request - Model-facing route fields from the tool call.
 * @returns Whether at least one route or effort field is present.
 */
export function hasDelegationModelRequest(request: DelegationModelRequest): boolean {
  return request.provider !== undefined
    || request.model !== undefined
    || request.reasoning_effort !== undefined
}

/** Reject an empty model-facing route value at the tool JSON boundary. */
function assertNonEmpty(value: string | undefined, field: keyof DelegationModelRequest): void {
  if (value !== undefined && value.length === 0) {
    throw new ToolArgsError([`child LLM \`${field}\` must be non-empty`])
  }
}

/**
 * Validate explicit selection against the Session policy and merge it over child defaults.
 * Explicit selection requires both provider and model; an omitted effort then
 * uses the selected model's default, even when the route is unchanged.
 * @param configured - Tool-instance child defaults.
 * @param request - Model-facing route override.
 * @param enabled - Whether this tool instance permits model-facing selection.
 * @param policy - Session allowlist; omission permits only the current parent route.
 * @param parentOptions - Current parent route used when no policy is recorded.
 * @returns Child Agent options, preserving omission when no layer contributes one.
 * @throws {SubagentError} `MODEL_SELECTION_DISABLED` when this tool instance
 *   forbids selection, or `MODEL_ROUTE_NOT_ALLOWED` when the Session does not allow the route.
 * @throws {ToolArgsError} when a field is empty or `provider` and `model` are not supplied together.
 */
export function requestedAgentOptions(
  configured: AgentOptions | undefined,
  request: DelegationModelRequest,
  enabled: boolean,
  policy: ModelSelectionPolicy | undefined,
  parentOptions: AgentOptions,
): AgentOptions | undefined {
  if (!hasDelegationModelRequest(request)) return configured
  if (!enabled) {
    throw new SubagentError('child model selection is disabled for this tool instance', 'MODEL_SELECTION_DISABLED')
  }
  assertNonEmpty(request.provider, 'provider')
  assertNonEmpty(request.model, 'model')
  assertNonEmpty(request.reasoning_effort, 'reasoning_effort')
  if (request.provider === undefined || request.model === undefined) {
    throw new ToolArgsError([request.reasoning_effort === undefined
      ? 'child LLM `provider` and `model` must be supplied together'
      : 'child LLM `reasoning_effort` requires both `provider` and `model`; supply both or omit all three fields'])
  }

  assertAllowedModelSelection(policy, parentOptions, { provider: request.provider, model: request.model })
  return {
    ...configured,
    provider: request.provider,
    model: request.model,
    // Explicit undefined also clears compatible parent effort during child-option merging.
    reasoningEffort: request.reasoning_effort === undefined ? undefined : brandString<ReasoningEffortId>(request.reasoning_effort),
  }
}

/**
 * Apply an authorized route's configured default reasoning effort when the
 * caller supplied neither a route effort nor a configured effort.
 * @param routes - Authorized exact routes, or undefined without a policy.
 * @param parentOptions - Current parent values that supply missing child values.
 * @param requested - Effective child options after request/config merging.
 * @returns Child options with the matching route's default effort, when present.
 */
export function applyAllowedRouteDefaultEffort(
  routes: readonly AllowedModelRoute[] | undefined,
  parentOptions: AgentOptions,
  requested: AgentOptions | undefined,
): AgentOptions | undefined {
  if (routes === undefined || requested?.reasoningEffort !== undefined) return requested
  const provider = requested?.provider ?? parentOptions.provider
  const model = requested?.model ?? parentOptions.model
  if (provider === undefined || model === undefined) return requested
  const route = allowedRouteFor(routes, provider, model)
  if (route?.reasoningEffort === undefined) return requested
  return { ...requested, reasoningEffort: brandString<ReasoningEffortId>(route.reasoningEffort) }
}

/**
 * Enforce Session authorization for a complete, explicitly selected child route.
 * @param policy - Session allowlist; omission permits only the current parent route.
 * @param parentOptions - Current parent route used when no policy is recorded.
 * @param route - Validated provider/model pair from the tool call.
 * @throws {SubagentError} `MODEL_ROUTE_NOT_ALLOWED` when the Session does not allow the route.
 */
export function assertAllowedModelSelection(
  policy: ModelSelectionPolicy | undefined,
  parentOptions: AgentOptions,
  route: AllowedModelRoute,
): void {
  const { provider, model } = route
  const allowed = policy === undefined
    ? provider === parentOptions.provider && model === parentOptions.model
    : policy.routes.some(route => route.provider === provider && route.model === model)
  if (allowed) return
  throw new SubagentError(`child LLM route "${provider}/${model}" is not allowed for this Session`
    + (policy === undefined
      ? '; without a recorded model-selection policy, explicit selection is limited to the parent route'
      : ''), 'MODEL_ROUTE_NOT_ALLOWED')
}

/**
 * Whether configured Agent options require route validation before delegation.
 * @param options - Tool-instance child defaults.
 * @returns Whether configured provider, model, or effort values must be resolved.
 */
export function hasConfiguredLlmSelection(options: AgentOptions | undefined): boolean {
  return options?.provider !== undefined
    || options?.model !== undefined
    || options?.reasoningEffort !== undefined
}

/**
 * Resolve an effective child route through its live adapter before the child is
 * created. The LLM runtime owns provider lookup, exact-model metadata, effort
 * validation, and adapter defaults.
 * @param llm - Live LLM runtime.
 * @param parentOptions - Current parent values whose compatible fields the child inherits.
 * @param requested - Per-child options after request/config merging.
 * @param signal - Tool-call cancellation signal.
 * @param inheritParentReasoningEffort - Whether an omitted effort may inherit from the parent route; false for explicit model selection.
 */
export async function preflightChildLlmRoute(
  llm: LlmRuntime,
  parentOptions: AgentOptions,
  requested: AgentOptions | undefined,
  signal: AbortSignal,
  inheritParentReasoningEffort = true,
): Promise<void> {
  const provider = requested?.provider ?? parentOptions.provider
  const model = requested?.model ?? parentOptions.model
  if (provider === undefined || model === undefined) {
    throw new ToolContextUnavailableError('cannot select child LLM values without an effective provider and model')
  }
  const routeChanged = provider !== parentOptions.provider || model !== parentOptions.model
  const reasoningEffort = requested?.reasoningEffort
    ?? (inheritParentReasoningEffort && !routeChanged ? parentOptions.reasoningEffort : undefined)
  await llm.resolveCallConfig({
    provider,
    model,
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
  }, signal)
}
