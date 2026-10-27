/** Durable per-session state for the user-controlled model-selection opt-in. */

import { z as zod } from 'zod'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import {
  assertAllowedModelRoutes,
  sameAllowedModelRoutes,
  type AllowedModelRoute,
} from './model-selection.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records this Session’s initial authorized child provider/model routes.
     * Each route may carry default reasoning effort and context-window
     * settings. Appended before the first model request when the Host
     * preference is enabled. A later policy-change event supersedes it.
     * Log-only: it carries no `surfaceOp` and never enters model history.
     */
    'subagent/model-selection-policy': {
      /** Exact routes this Session may select explicitly for a child. */
      allowedModels: AllowedModelRoute[]
    }

    /**
     * Records a live change to this Session’s authorized child routes.
     * Appended when the Host preference changes while the Session is live, or
     * when a restored Session observes a different current preference. The
     * latest policy event wins; `enabled: false` restricts explicit selection
     * to the current parent route without discarding saved routes. Log-only:
     * it carries no `surfaceOp` and never enters model history.
     */
    'subagent/model-selection-policy-change': {
      /** Whether child model selection is enabled for this Session. */
      enabled: boolean
      /** Current saved routes and their default efforts/windows; ignored unless `enabled` is true. */
      allowedModels: AllowedModelRoute[]
    }
  }
}

const modelSelectionPolicySchema = zod.array(zod.object({
  provider: zod.string().min(1),
  model: zod.string().min(1),
  reasoningEffort: zod.string().min(1).optional(),
  contextWindow: zod.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict()).min(1).nullable() as zod.ZodType<AllowedModelRoute[] | null>

/**
 * Host-only projection of the durable model-selection policy.
 * Each independently mounted consumer registers this shared definition; the registry reference-counts it.
 */
export const subagentModelSelectionProjectionDefinition = {
  key: 'subagentModelSelectionPolicy',
  stateVersion: 2,
  stateSchema: modelSelectionPolicySchema,
  init: () => null,
  apply: (policy, event) => {
    if (event.type === 'subagent/model-selection-policy') {
      if (policy !== null) return policy
      const { allowedModels } = event.data
      assertAllowedModelRoutes(allowedModels)
      if (allowedModels.length === 0) {
        throw new Error('subagent/model-selection-policy requires at least one route')
      }
      return allowedModels
    }
    if (event.type !== 'subagent/model-selection-policy-change') return policy
    const { enabled, allowedModels } = event.data
    if (typeof enabled !== 'boolean') {
      throw new Error('subagent/model-selection-policy-change requires a boolean enabled value')
    }
    assertAllowedModelRoutes(allowedModels)
    if (!enabled) return policy === null ? policy : null
    if (allowedModels.length === 0) {
      throw new Error('enabled subagent/model-selection-policy-change requires at least one route')
    }
    return sameAllowedModelRoutes(policy, allowedModels) ? policy : allowedModels
  },
} satisfies ProjectionDefinition<'subagentModelSelectionPolicy', AllowedModelRoute[] | null>

/**
 * Read the latest exact route list authorized for a Session.
 * @param subagentModelSelectionProjectionHandle - registered policy state reader.
 * @param session - session whose durable decision is read.
 * @returns a detached route list, or undefined to restrict selection to the parent route.
 */
export function subagentModelSelectionPolicy(
  subagentModelSelectionProjectionHandle: Pick<ProjectionHandle<AllowedModelRoute[] | null>, 'stateOf'>,
  session: Session,
): AllowedModelRoute[] | undefined {
  return subagentModelSelectionProjectionHandle.stateOf(session)?.map(route => ({ ...route }))
}
