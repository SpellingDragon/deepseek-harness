/** Host-owned opt-in setting for model-selectable subagent delegation. */
import type { Volatile } from '@deepseek-ai/cordis'

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
// Type-only: the Agent lifecycle payload and the Loader's volatile-update event.
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import {
  subagentModelSelectionPolicy,
  subagentModelSelectionProjectionDefinition,
} from './model-selection-state.ts'
import {
  AllowedModelRouteSchema,
  assertAllowedModelRoutes,
  sameAllowedModelRoutes,
  type AllowedModelRoute,
} from './model-selection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User preference applied to new and live Agents. */
    subagentModelSelection: SubagentModelSelectionConfig
  }
}

/** Stored user preference; the shipped composition defaults it off. */
export interface SubagentModelSelectionSettings {
  /** Whether Sessions receive model selection. */
  enabled: boolean
  /** Exact child LLM routes offered to Sessions, with optional default efforts. */
  allowedModels: AllowedModelRoute[]
}

/** Optional deployment base for the preference. */
export interface Config {
  /** Initial enabled state inherited when the user document does not override it. */
  enabled: Volatile<boolean>
  /** Initial route list with optional default efforts inherited when the user document does not override it. */
  allowedModels: Volatile<AllowedModelRoute[]>
}

/** Host settings owner that keeps each Session's recorded authorization aligned with the current preference. */
export class SubagentModelSelectionConfig extends Service {
  static inject = ['sessionProjections']

  static Config = z.object({
    enabled: z.boolean().default(false).volatile(),
    allowedModels: z.array(AllowedModelRouteSchema).default([]).volatile(),
  })

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'subagentModelSelection')
  }

  protected async [Service.init](): Promise<void> {
    const ctx = this.ctx
    const policyReady = ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)
    ctx.on('agent/created', async ({ agent, source }) => {
      const policy = await policyReady
      ctx.fiber.assertActive()
      this.reconcile(policy, agent.session, source === 'startup')
      this.applyContextWindow(policy, agent)
    })
    const policy = await policyReady
    ctx.fiber.assertActive()
    ctx.on('loader/volatile-update', (paths) => {
      if (!paths.some(path => path[0] === 'enabled' || path[0] === 'allowedModels')) return
      this.reconcileLiveAgents(policy)
    })
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'model/selection') return
      const agent = ctx.get('agents')?.get(session.id)
      if (agent !== undefined) this.applyContextWindow(policy, agent)
    })
    for (const agent of ctx.get('agents')?.list() ?? []) this.applyContextWindow(policy, agent)
  }

  /**
   * Align one live Session with the current preference, recording an event only when authorization differs.
   * @param policy - registered projection reader.
   * @param session - Session whose durable policy is read and updated.
   * @param initial - whether this is a fresh startup Session that may receive the initial policy event.
   */
  private reconcile(
    policy: Pick<ProjectionHandle<AllowedModelRoute[] | null>, 'stateOf'>,
    session: Session,
    initial: boolean,
  ): void {
    const preference = this.current()
    const recorded = subagentModelSelectionPolicy(policy, session)
    const desired = preference.enabled ? preference.allowedModels : undefined
    if (sameAllowedModelRoutes(recorded, desired)) return
    if (initial && preference.enabled && recorded === undefined) {
      session.append('subagent/model-selection-policy', { allowedModels: preference.allowedModels })
      return
    }
    session.append('subagent/model-selection-policy-change', {
      enabled: preference.enabled,
      allowedModels: preference.allowedModels,
    })
  }

  /** Reconcile every live Agent after the preference changes. */
  private reconcileLiveAgents(policy: Pick<ProjectionHandle<AllowedModelRoute[] | null>, 'stateOf'>): void {
    const agents = this.ctx.get('agents')
    if (agents === undefined) return
    for (const agent of agents.list()) {
      this.reconcile(policy, agent.session, false)
      this.applyContextWindow(policy, agent)
    }
  }

  /**
   * Apply the authorized route's context-window override to one child Agent.
   * Top-level Agents keep their adapter metadata; child Agents update live
   * before their next request or compaction pass. Without an authorized route,
   * the current window is left unchanged.
   */
  private applyContextWindow(
    policy: Pick<ProjectionHandle<AllowedModelRoute[] | null>, 'stateOf'>,
    agent: Agent,
  ): void {
    if (agent.session.header.origin !== 'subagent') return
    const selection = agent.model.current()
    const provider = selection?.provider ?? agent.options.provider
    const model = selection?.model ?? agent.options.model
    if (provider === undefined || model === undefined) return
    const route = subagentModelSelectionPolicy(policy, agent.session)
      ?.find(route => route.provider === provider && route.model === model)
    if (route === undefined) return
    agent.contextWindow = route.contextWindow
  }

  /**
   * Read a detached selection preference for the current Session policy.
   * @returns the enabled state and exact allowed routes.
   */
  private current(): SubagentModelSelectionSettings {
    const enabled = this.config.enabled.get()
    const allowedModels = this.config.allowedModels.get()
    assertAllowedModelRoutes(allowedModels)
    if (enabled && allowedModels.length === 0) {
      throw new Error('enabled subagent model selection requires at least one allowed model')
    }
    return { enabled, allowedModels: allowedModels.map(route => ({ ...route })) }
  }

}

export const name = 'subagent-model-selection-settings'
export default SubagentModelSelectionConfig
