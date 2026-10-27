/** Child LLM route selection for the subagent tool. */

import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
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
}

/** Schema shared by the Host setting and its deployment base. */
export const AllowedModelRouteSchema: z<AllowedModelRoute> = z.object({
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
  reasoningEffort: z.string().min(1),
  contextWindow: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
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
 * Stable policy identity for one route, including its default effort.
 * @param route - Exact provider/model route and optional default effort.
 * @returns Opaque key for policy equality checks.
 */
function modelRoutePolicyKey(route: AllowedModelRoute): string {
  return `${modelRouteKey(route)}\0${route.reasoningEffort ?? ''}\0${route.contextWindow ?? ''}`
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
    const route = {
      provider: candidate.provider,
      model: candidate.model,
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
      ...contextWindow === undefined ? {} : { contextWindow },
    }
    const key = modelRouteKey(route)
    if (seen.has(key)) {
      throw new Error(`subagent model selection repeats route "${route.provider}/${route.model}"`)
    }
    seen.add(key)
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
    throw new Error(`child LLM \`${field}\` must be non-empty`)
  }
}

/**
 * Merge model-supplied selection fields over configured child defaults.
 * Provider and model form one route and must be supplied together. Changing
 * that route without an effort clears the configured route-owned effort.
 * @param parentOptions - Current parent values that supply missing child values.
 * @param configured - Tool-instance child defaults.
 * @param request - Model-facing route override.
 * @param enabled - Whether this tool instance permits model-facing selection.
 * @returns Child Agent options, preserving omission when no layer contributes one.
 */
export function requestedAgentOptions(
  parentOptions: AgentOptions,
  configured: AgentOptions | undefined,
  request: DelegationModelRequest,
  enabled: boolean,
): AgentOptions | undefined {
  if (!hasDelegationModelRequest(request)) return configured
  if (!enabled) {
    throw new Error('child model selection is disabled for this tool instance')
  }
  assertNonEmpty(request.provider, 'provider')
  assertNonEmpty(request.model, 'model')
  assertNonEmpty(request.reasoning_effort, 'reasoning_effort')
  if ((request.provider === undefined) !== (request.model === undefined)) {
    throw new Error('child LLM `provider` and `model` must be supplied together')
  }

  const baselineProvider = configured?.provider ?? parentOptions.provider
  const baselineModel = configured?.model ?? parentOptions.model
  const routeChanged = request.provider !== undefined
    && (request.provider !== baselineProvider || request.model !== baselineModel)
  const { reasoningEffort: _configuredReasoningEffort, ...configuredWithoutReasoning } = configured ?? {}
  return {
    ...routeChanged && request.reasoning_effort === undefined ? configuredWithoutReasoning : configured,
    ...request.provider === undefined ? {} : { provider: request.provider, model: request.model },
    ...request.reasoning_effort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(request.reasoning_effort) },
  }
}

/**
 * Apply an authorized route's configured default reasoning effort and context
 * window when the caller supplied neither value.
 * @param routes - Authorized exact routes, or undefined without a policy.
 * @param parentOptions - Current parent values that supply missing child values.
 * @param requested - Effective child options after request/config merging.
 * @returns Child options with the matching route's defaults, when present.
 */
export function applyAllowedRouteDefaults(
  routes: readonly AllowedModelRoute[] | undefined,
  parentOptions: AgentOptions,
  requested: AgentOptions | undefined,
): AgentOptions | undefined {
  if (routes === undefined) return requested
  const provider = requested?.provider ?? parentOptions.provider
  const model = requested?.model ?? parentOptions.model
  if (provider === undefined || model === undefined) return requested
  const route = allowedRouteFor(routes, provider, model)
  if (route === undefined) return requested
  const reasoningEffort = requested?.reasoningEffort === undefined ? route.reasoningEffort : undefined
  const contextWindow = requested?.contextWindow === undefined ? route.contextWindow : undefined
  if (reasoningEffort === undefined && contextWindow === undefined) return requested
  return {
    ...requested,
    ...reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) },
    ...contextWindow === undefined ? {} : { contextWindow },
  }
}

/**
 * Enforce a settings-owned route list at the operation that creates the child.
 * Pure inheritance remains outside this policy because no model-facing choice
 * occurred; any explicit route or effort field must resolve to an allowed route.
 * @param policy - Session allowlist; omission permits only the current parent route.
 * @param parentOptions - Current parent values that supply missing child values.
 * @param requested - Effective child options after request/config merging.
 * @param request - Model-facing selection fields from the tool call.
 */
export function assertAllowedModelSelection(
  policy: ModelSelectionPolicy | undefined,
  parentOptions: AgentOptions,
  requested: AgentOptions | undefined,
  request: DelegationModelRequest,
): void {
  if (!hasDelegationModelRequest(request)) return
  const provider = requested?.provider ?? parentOptions.provider
  const model = requested?.model ?? parentOptions.model
  if (provider === undefined || model === undefined) {
    throw new Error('cannot select child LLM values without an effective provider and model')
  }
  const allowed = policy === undefined
    ? provider === parentOptions.provider && model === parentOptions.model
    : policy.routes.some(route => route.provider === provider && route.model === model)
  if (allowed) return
  throw new Error(`child LLM route "${provider}/${model}" is not allowed for this Session`
    + (policy === undefined
      ? '; without a recorded model-selection policy, explicit selection (including reasoning_effort) is limited to the parent route'
      : ''))
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
 * @param inheritParentReasoningEffort - Whether an omitted effort may inherit from the parent route.
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
    throw new Error('cannot select child LLM values without an effective provider and model')
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
