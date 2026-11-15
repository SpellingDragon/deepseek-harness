/** Live context-window override for one Agent, recorded as a log-only Session event. */
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { z as zod } from 'zod'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records the Agent's live context-window override. Appended by the
     * settings owner before a request or compaction pass; the latest event
     * wins and `null` returns to adapter metadata. Log-only: it carries no
     * `surfaceOp` and never enters model history.
     */
    'agent/context-window': {
      /** Positive token capacity, or null to follow adapter metadata. */
      contextWindow: number | null
    }
  }
}

const contextWindowStateSchema = zod.number().int().positive().nullable()

/**
 * Host projection of the latest context-window override.
 * Each independently mounted consumer registers this shared definition; the registry reference-counts it.
 */
export const agentContextWindowProjectionDefinition = {
  key: 'agentContextWindow',
  stateVersion: 1,
  stateSchema: contextWindowStateSchema,
  init: () => null,
  apply: (state, event) => event.type === 'agent/context-window' ? event.data.contextWindow : state,
} satisfies ProjectionDefinition<'agentContextWindow', number | null>

/**
 * Read the latest recorded context-window override for one Session.
 * @param projection - registered projection state reader.
 * @param session - Session whose durable override is read.
 * @returns the positive capacity, or undefined to follow adapter metadata.
 */
export function agentContextWindowOf(
  projection: Pick<ProjectionHandle<number | null>, 'stateOf'>,
  session: Session,
): number | undefined {
  return projection.stateOf(session) ?? undefined
}
