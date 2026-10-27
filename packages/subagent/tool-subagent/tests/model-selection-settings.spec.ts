/** Default-off settings and per-session model-selection decisions. */
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { mountWorkingDirectoryFixture } from '../../subagent/tests/working-directory-fixture.ts'

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { bindScopeParent, createScope, scopeOf, scopeTarget } from '@deepseek-ai/dsh-scope'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as tool from '../src/index.ts'
import SubagentModelSelectionConfig from '../src/model-selection-settings.ts'
import {
  subagentModelSelectionPolicy,
  subagentModelSelectionProjectionDefinition,
} from '../src/model-selection-state.ts'
import { callSubagent, ownContext, text } from './harness.ts'

const ALLOWED_MODELS = [{ provider: 'alpha', model: 'fast-model' }]

const selectionConfigs = new WeakMap<Context, Awaited<ReturnType<typeof liveConfig>>>()
const subagentConfigs = new WeakMap<Context, Awaited<ReturnType<typeof liveConfig>>>()

/** Read whether one Agent's delegation definition contains route fields. */
function selectable(ctx: Context, agent: Awaited<ReturnType<Context['agents']['create']>>['agent']): boolean {
  const schema = ctx.tools.schemas(agent).find(candidate => candidate.name === 'subagent')
  const properties = (schema?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties
  return properties?.['provider'] !== undefined
    && properties['model'] !== undefined
    && properties['reasoning_effort'] !== undefined
    && ctx.tools.schemas(agent).some(candidate => candidate.name === 'list_subagent_models')
}

const modelSelectionPresets = new WeakMap<Context, ReturnType<typeof createScope>>()

/** Mount the real settings, Agent, provider, and optional preset tool services. */
async function boot(withPreset = true): Promise<Context> {
  const ctx = ownContext(new Context())

  await mountAgentLoopTestDependencies(ctx)
  selectionConfigs.set(ctx, await liveConfig(ctx, SubagentModelSelectionConfig))
  await ctx.plugin(AgentLoop, { agents: [] })
  await mountWorkingDirectoryFixture(ctx)
  subagentConfigs.set(ctx, await liveConfig(ctx, SubagentRuntime))
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  if (withPreset) {
    const preset = createScope(ctx, { preset: 'model-selection-test' })
    await preset.ctx.plugin(tool, {
      provider: 'spawn',
      modelSelection: true,
      modelDiscovery: true,
    })
    modelSelectionPresets.set(ctx, preset)
  }
  return ctx
}

/** Create one Agent joined to the test's standing preset. */
async function createAgent(ctx: Context, id: string, options: {
  meta?: { parentSession: SessionId; origin: 'subagent' }
  seed?: readonly SessionEvent[]
  agentOptions?: { provider?: string; model?: string }
} = {}) {
  const preset = modelSelectionPresets.get(ctx)
  if (preset === undefined) throw new Error('context has no model-selection preset')
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    ...options,
    setup: (agentCtx) => {
      bindScopeParent(scopeOf(agentCtx)!, scopeOf(preset.ctx)!)
    },
  })
  return handle.agent
}

let policySessionCounter = 0

/** Observe settings through the policy captured by a fresh top-level Agent. */
async function capturePolicy(ctx: Context) {
  const { agent } = await ctx.agents.create({ sessionId: SessionId(`settings-policy-${++policySessionCounter}`) })
  const policy = await ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)
  return subagentModelSelectionPolicy(policy, agent.session)
}

describe('SubagentModelSelectionConfig', () => {
  it('uses the composed default without a settings provider', async () => {
    const ctx = ownContext(new Context())
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentModelSelectionConfig, { enabled: true, allowedModels: ALLOWED_MODELS })

    expect(await capturePolicy(ctx)).toEqual(ALLOWED_MODELS)
    await ctx.fiber.dispose()
  })

  it('defaults off and follows the validated user layer for live and new Sessions', async () => {
    const ctx = ownContext(new Context())
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    await ctx.plugin(AgentLoop, { agents: [] })

    selectionConfigs.set(ctx, await liveConfig(ctx, SubagentModelSelectionConfig))
    const policy = await ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)
    const live = await ctx.agents.create({ sessionId: SessionId('live-policy') })

    expect(subagentModelSelectionPolicy(policy, live.agent.session)).toBeUndefined()
    await selectionConfigs.get(ctx)!.update({
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    expect(subagentModelSelectionPolicy(policy, live.agent.session)).toEqual(ALLOWED_MODELS)

    const created = await ctx.agents.create({ sessionId: SessionId('created-after-enable') })
    expect(subagentModelSelectionPolicy(policy, created.agent.session)).toEqual(ALLOWED_MODELS)

    await selectionConfigs.get(ctx)!.update({ enabled: false })
    expect(subagentModelSelectionPolicy(policy, live.agent.session)).toBeUndefined()
    expect(subagentModelSelectionPolicy(policy, created.agent.session)).toBeUndefined()
    expect(live.agent.session.snapshotEvents()
      .filter(event => event.type === 'subagent/model-selection-policy-change')).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it('rejects duplicate routes, enabled empty settings, and an empty durable policy', async () => {
    const ctx = ownContext(new Context())
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    await ctx.plugin(AgentLoop, { agents: [] })

    selectionConfigs.set(ctx, await liveConfig(ctx, SubagentModelSelectionConfig))
    await ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)

    // File-written invalid settings reject Agent creation even without delegation tools.
    await selectionConfigs.get(ctx)!.update({ allowedModels: [...ALLOWED_MODELS, ...ALLOWED_MODELS] })
    await expect(capturePolicy(ctx)).rejects.toThrow('repeats route "alpha/fast-model"')

    await selectionConfigs.get(ctx)!.update({ enabled: true, allowedModels: [] })
    await expect(capturePolicy(ctx)).rejects.toThrow('enabled subagent model selection requires at least one allowed model')
    await selectionConfigs.get(ctx)!.update({
      enabled: false,
      allowedModels: ALLOWED_MODELS,
    })
    expect(await capturePolicy(ctx)).toBeUndefined()
    await selectionConfigs.get(ctx)!.update({ allowedModels: [] })
    expect(await capturePolicy(ctx)).toBeUndefined()

    const invalid = Session.create(SessionId('empty-policy'))
    invalid.append('subagent/model-selection-policy', { allowedModels: [] })
    const policy = await ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)
    expect(() => subagentModelSelectionPolicy(policy, invalid)).toThrow('requires at least one route')

    const malformed = Session.create(SessionId('malformed-policy'))
    malformed.append('subagent/model-selection-policy', {
      allowedModels: [{ provider: 1, model: 'fast-model' }],
    } as never)
    expect(() => subagentModelSelectionPolicy(policy, malformed))
      .toThrow('requires non-empty provider and model ids')

    const malformedEffort = Session.create(SessionId('malformed-policy-effort'))
    malformedEffort.append('subagent/model-selection-policy', {
      allowedModels: [{ provider: 'alpha', model: 'fast-model', reasoningEffort: '' }],
    })
    expect(() => subagentModelSelectionPolicy(policy, malformedEffort))
      .toThrow('requires a non-empty reasoning effort')

    const cleared = Session.create(SessionId('cleared-policy'))
    cleared.append('subagent/model-selection-policy', { allowedModels: ALLOWED_MODELS })
    cleared.append('subagent/model-selection-policy-change', {
      enabled: false,
      allowedModels: ALLOWED_MODELS,
    })
    expect(subagentModelSelectionPolicy(policy, cleared)).toBeUndefined()

    const reenabled = Session.create(SessionId('reenabled-policy'))
    reenabled.append('subagent/model-selection-policy-change', {
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    expect(subagentModelSelectionPolicy(policy, reenabled)).toEqual(ALLOWED_MODELS)

    const repeatedInitial = Session.create(SessionId('repeated-initial-policy'))
    repeatedInitial.append('subagent/model-selection-policy', { allowedModels: ALLOWED_MODELS })
    repeatedInitial.append('subagent/model-selection-policy', {
      allowedModels: [{ provider: 'beta', model: 'fast-model' }],
    })
    expect(subagentModelSelectionPolicy(policy, repeatedInitial)).toEqual(ALLOWED_MODELS)

    const disabledOnly = Session.create(SessionId('disabled-only-policy'))
    disabledOnly.append('subagent/model-selection-policy-change', {
      enabled: false,
      allowedModels: ALLOWED_MODELS,
    })
    expect(subagentModelSelectionPolicy(policy, disabledOnly)).toBeUndefined()

    const unchangedChange = Session.create(SessionId('unchanged-policy-change'))
    unchangedChange.append('subagent/model-selection-policy', { allowedModels: ALLOWED_MODELS })
    unchangedChange.append('subagent/model-selection-policy-change', {
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    expect(subagentModelSelectionPolicy(policy, unchangedChange)).toEqual(ALLOWED_MODELS)

    const enabledWithoutRoutes = Session.create(SessionId('enabled-without-routes'))
    enabledWithoutRoutes.append('subagent/model-selection-policy-change', {
      enabled: true,
      allowedModels: [],
    })
    expect(() => subagentModelSelectionPolicy(policy, enabledWithoutRoutes))
      .toThrow('enabled subagent/model-selection-policy-change requires at least one route')

    const malformedChange = Session.create(SessionId('malformed-policy-change'))
    malformedChange.append('subagent/model-selection-policy-change', {
      enabled: 'yes',
      allowedModels: ALLOWED_MODELS,
    } as never)
    expect(() => subagentModelSelectionPolicy(policy, malformedChange))
      .toThrow('requires a boolean enabled value')
    await ctx.fiber.dispose()
  })

  it('updates existing and new root Sessions without changing tool definitions', async () => {
    const ctx = await boot()
    const first = await createAgent(ctx, 'first')
    expect(selectable(ctx, first)).toBe(true)
    const policy = await ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)
    expect(subagentModelSelectionPolicy(policy, first.session)).toBeUndefined()

    await selectionConfigs.get(ctx)!.update({
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    expect(subagentModelSelectionPolicy(policy, first.session)).toEqual(ALLOWED_MODELS)
    const enabled = await createAgent(ctx, 'enabled')
    expect(subagentModelSelectionPolicy(policy, enabled.session)).toEqual(ALLOWED_MODELS)
    expect(selectable(ctx, enabled)).toBe(true)
    expect(selectable(ctx, first)).toBe(true)

    await selectionConfigs.get(ctx)!.update({ enabled: false })
    expect(subagentModelSelectionPolicy(policy, first.session)).toBeUndefined()
    expect(subagentModelSelectionPolicy(policy, enabled.session)).toBeUndefined()
    const disabledAgain = await createAgent(ctx, 'disabled-again')
    expect(selectable(ctx, disabledAgain)).toBe(true)
    await ctx.fiber.dispose()
  })

  it('installs a direct Agent setup before Agent publication', async () => {
    const ctx = await boot(false)
    await selectionConfigs.get(ctx)!.update({
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    let prepared: Awaited<ReturnType<Context['agents']['create']>>['agent'] | undefined
    let visibleAtAgentCreated = false
    ctx.on('agent/created', () => {
      visibleAtAgentCreated = prepared !== undefined && selectable(ctx, prepared)
    })

    const handle = await ctx.agents.create({
      sessionId: SessionId('direct-agent-setup'),
      setup: async (agentCtx, agent) => {
        prepared = agent
        const fiber = agentCtx.inject(tool.inject, (runtimeCtx) => {
          return tool.apply(runtimeCtx, {
            provider: 'spawn',
            modelSelection: true,
            modelDiscovery: true,
          })
        })
        await fiber.await()
      },
    })

    expect(visibleAtAgentCreated).toBe(true)
    expect(selectable(ctx, handle.agent)).toBe(true)
    await handle.dispose()
    await ctx.fiber.dispose()
  })

  it('updates a Session that joins a preset after the preference changes', async () => {
    const ctx = await boot()
    const disabled = await createAgent(ctx, 'already-disabled')
    const joining = await ctx.agents.create({ sessionId: SessionId('joining-preset') })
    await selectionConfigs.get(ctx)!.update({ enabled: true, allowedModels: ALLOWED_MODELS })
    const preset = modelSelectionPresets.get(ctx)!
    bindScopeParent(scopeOf(joining.agent.ctx)!, scopeOf(preset.ctx)!)
    ctx.emit(scopeTarget({}, scopeOf(preset.ctx)), 'tools/change')
    const policy = await ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)
    expect(subagentModelSelectionPolicy(policy, joining.agent.session)).toEqual(ALLOWED_MODELS)
    expect(subagentModelSelectionPolicy(policy, disabled.session)).toEqual(ALLOWED_MODELS)
    await ctx.fiber.dispose()
  })

  it('updates authorization without delegation tools and does not resample on tool installation', async () => {
    const ctx = await boot(false)
    await selectionConfigs.get(ctx)!.update({ enabled: true, allowedModels: ALLOWED_MODELS })
    const preset = createScope(ctx, { preset: 'late-tools' })
    const inside = await ctx.agents.create({
      sessionId: SessionId('existing-inside'),
      setup: (agentCtx) => { bindScopeParent(scopeOf(agentCtx)!, scopeOf(preset.ctx)!) },
    })
    const outside = await ctx.agents.create({ sessionId: SessionId('existing-outside') })
    const policy = await ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)
    expect(subagentModelSelectionPolicy(policy, inside.agent.session)).toEqual(ALLOWED_MODELS)
    expect(subagentModelSelectionPolicy(policy, outside.agent.session)).toEqual(ALLOWED_MODELS)

    await selectionConfigs.get(ctx)!.update({ enabled: false })
    expect(subagentModelSelectionPolicy(policy, inside.agent.session)).toBeUndefined()
    expect(subagentModelSelectionPolicy(policy, outside.agent.session)).toBeUndefined()

    await preset.ctx.plugin(tool, { provider: 'spawn', modelSelection: true, modelDiscovery: true })
    expect(subagentModelSelectionPolicy(policy, inside.agent.session)).toBeUndefined()
    expect(subagentModelSelectionPolicy(policy, outside.agent.session)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('does not register tools when recording the Session policy triggers a registry refresh', async () => {
    const ctx = await boot()
    try {
      await selectionConfigs.get(ctx)!.update({
        enabled: true,
        allowedModels: ALLOWED_MODELS,
      })
      const preset = modelSelectionPresets.get(ctx)!
      ctx.on('session/event', (_session, event) => {
        if (event.type === 'subagent/model-selection-policy') {
          ctx.emit(scopeTarget({}, scopeOf(preset.ctx)), 'tools/change')
        }
      })
      const register = vi.spyOn(ctx.tools, 'register')

      const agent = await createAgent(ctx, 'policy-refresh')

      expect(selectable(ctx, agent)).toBe(true)
      expect(register).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects a forced route outside the Session policy before child creation', async () => {
    const ctx = await boot()
    await selectionConfigs.get(ctx)!.update({
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    const agent = await createAgent(ctx, 'enforced')

    const result = await executeToolFixture(ctx, {
      signal: new AbortController().signal,
      callId: ToolCallId('disallowed-session-route'),
      name: 'subagent',
      arguments: {
        description: 'forced route',
        prompt: 'do it',
        provider: 'alpha',
        model: 'other-model',
      },
      agent,
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('is not allowed for this Session')
    await ctx.fiber.dispose()
  })

  it('shares definitions across Agents and lets scope ancestry own their visibility', async () => {
    const ctx = await boot(false)
    const preset = createScope(ctx, { preset: 'standard' })
    const other = createScope(ctx, { preset: 'minimal' })
    await preset.ctx.plugin(tool, {
      provider: 'spawn',
      modelSelection: true,
      modelDiscovery: true,
    })

    let enabledBinding: ReturnType<typeof bindScopeParent> | undefined
    const createComposed = async (id: string) => ctx.agents.create({
      sessionId: SessionId(id),
      setup: (agentCtx) => {
        const binding = bindScopeParent(scopeOf(agentCtx)!, scopeOf(preset.ctx)!)
        if (id === 'preset-enabled') enabledBinding = binding
      },
    })

    const disabled = await createComposed('preset-disabled')
    expect(selectable(ctx, disabled.agent)).toBe(true)
    await selectionConfigs.get(ctx)!.update({
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    const enabled = await createComposed('preset-enabled')
    expect(selectable(ctx, enabled.agent)).toBe(true)
    expect(selectable(ctx, disabled.agent)).toBe(true)
    expect(ctx.tools.get('subagent', enabled.agent)).toBe(ctx.tools.get('subagent', disabled.agent))
    expect(ctx.tools.get('subagent', enabled.agent)).toBe(ctx.tools.get('subagent', scopeOf(preset.ctx)))

    enabledBinding!.rebind(scopeOf(other.ctx)!)
    ctx.emit(scopeTarget({}, scopeOf(preset.ctx)), 'tools/change')
    await vi.waitFor(() => { expect(selectable(ctx, enabled.agent)).toBe(false) })
    const next = () => Promise.resolve({ kind: 'enter' as const, messages: [] })
    const payload = {
      agent: enabled.agent,
      modelSelection: { provider: 'mock', model: 'mock' },
      messages: [],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }
    await expect(ctx.waterfall(ctx as never, 'agent/pre-step', payload, next))
      .resolves.toEqual({ kind: 'enter', messages: [] })

    enabledBinding!.rebind(scopeOf(preset.ctx)!)
    ctx.emit(scopeTarget({}, scopeOf(preset.ctx)), 'tools/change')
    await vi.waitFor(() => { expect(selectable(ctx, enabled.agent)).toBe(true) })
    await expect(ctx.waterfall(ctx as never, 'agent/pre-step', payload, next))
      .resolves.toEqual({ kind: 'enter', messages: [] })

    await enabled.dispose()
    ctx.emit(scopeTarget({}, scopeOf(preset.ctx)), 'tools/change')
    await disabled.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps shared delegation and discovery hidden by the existing inherited-tool filter', async () => {
    const ctx = await boot()
    try {
      const parent = await createAgent(ctx, 'filter-parent')
      const preset = modelSelectionPresets.get(ctx)!
      const child = (await ctx.agents.create({
        sessionId: SessionId('filter-child'),
        meta: { parentSession: parent.id, origin: 'subagent' },
        setup: (childCtx) => {
          bindScopeParent(scopeOf(childCtx)!, scopeOf(preset.ctx)!)
          childCtx.tools.restrict({ deny: ['subagent', 'list_subagent_models'] })
        },
      })).agent
      expect(ctx.tools.get('subagent', parent)).toBeDefined()
      expect(ctx.tools.get('subagent', child)).toBeUndefined()
      expect(ctx.tools.get('list_subagent_models', child)).toBeUndefined()
      const result = await executeToolFixture(ctx, {
        name: 'subagent', callId: ToolCallId('filtered-delegation'), arguments: {},
        agent: child, signal: new AbortController().signal,
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('unknown tool')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('applies the current preference to new children and restored Sessions', async () => {
    const ctx = await boot()
    await selectionConfigs.get(ctx)!.update({
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    const parent = await createAgent(ctx, 'parent')
    const policy = await ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)
    expect(subagentModelSelectionPolicy(policy, parent.session)).toEqual(ALLOWED_MODELS)

    await selectionConfigs.get(ctx)!.update({
      enabled: true,
      allowedModels: [{ provider: 'beta', model: 'fast-model' }],
    })
    expect(subagentModelSelectionPolicy(policy, parent.session))
      .toEqual([{ provider: 'beta', model: 'fast-model' }])
    const child = await createAgent(ctx, 'child', {
      meta: { parentSession: parent.id, origin: 'subagent' },
    })
    expect(selectable(ctx, child)).toBe(true)
    expect(subagentModelSelectionPolicy(policy, child.session))
      .toEqual([{ provider: 'beta', model: 'fast-model' }])

    const orphan = await createAgent(ctx, 'orphan', {
      meta: { parentSession: SessionId('missing-parent'), origin: 'subagent' },
    })
    expect(selectable(ctx, orphan)).toBe(true)
    expect(subagentModelSelectionPolicy(policy, orphan.session))
      .toEqual([{ provider: 'beta', model: 'fast-model' }])

    const enabledSeed = Session.create(SessionId('enabled-seed'))
    enabledSeed.append('subagent/model-selection-policy', { allowedModels: ALLOWED_MODELS })
    const resumedEnabled = await createAgent(ctx, 'resumed-enabled', { seed: enabledSeed.snapshotEvents() })
    expect(selectable(ctx, resumedEnabled)).toBe(true)
    expect(subagentModelSelectionPolicy(policy, resumedEnabled.session))
      .toEqual([{ provider: 'beta', model: 'fast-model' }])

    const resumedEmpty = await createAgent(ctx, 'resumed-empty', { seed: [] })
    expect(selectable(ctx, resumedEmpty)).toBe(true)
    expect(subagentModelSelectionPolicy(policy, resumedEmpty.session))
      .toEqual([{ provider: 'beta', model: 'fast-model' }])

    await selectionConfigs.get(ctx)!.update({ enabled: false })
    const resumedDisabled = await createAgent(ctx, 'resumed-disabled', { seed: enabledSeed.snapshotEvents() })
    expect(selectable(ctx, resumedDisabled)).toBe(true)
    expect(subagentModelSelectionPolicy(policy, resumedDisabled.session)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('records no change when the authorized route set is unchanged', async () => {
    const ctx = await boot()
    await selectionConfigs.get(ctx)!.update({
      enabled: true,
      allowedModels: [
        { provider: 'alpha', model: 'fast-model' },
        { provider: 'beta', model: 'fast-model' },
      ],
    })
    const agent = await createAgent(ctx, 'stable-policy')
    const policyEvents = () => agent.session.snapshotEvents()
      .filter(event => event.type === 'subagent/model-selection-policy'
        || event.type === 'subagent/model-selection-policy-change')
    expect(policyEvents()).toHaveLength(1)

    await selectionConfigs.get(ctx)!.update({
      enabled: true,
      allowedModels: [
        { provider: 'beta', model: 'fast-model' },
        { provider: 'alpha', model: 'fast-model' },
      ],
    })
    expect(policyEvents()).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('propagates per-route default reasoning effort changes', async () => {
    const ctx = await boot()
    await selectionConfigs.get(ctx)!.update({ enabled: true, allowedModels: ALLOWED_MODELS })
    const agent = await createAgent(ctx, 'effort-policy')
    const policy = await ctx.sessionProjections.register(subagentModelSelectionProjectionDefinition)
    expect(subagentModelSelectionPolicy(policy, agent.session)).toEqual(ALLOWED_MODELS)

    const withEffort = ALLOWED_MODELS.map(route => ({
      ...route, reasoningEffort: 'max', contextWindow: 64_000,
    }))
    await selectionConfigs.get(ctx)!.update({ enabled: true, allowedModels: withEffort })
    expect(subagentModelSelectionPolicy(policy, agent.session)).toEqual(withEffort)
    expect(agent.session.snapshotEvents()
      .filter(event => event.type === 'subagent/model-selection-policy-change')).toHaveLength(1)

    const seeded = Session.create(SessionId('effort-seed'))
    seeded.append('subagent/model-selection-policy', { allowedModels: withEffort })
    expect(subagentModelSelectionPolicy(policy, seeded)).toEqual(withEffort)
    await ctx.fiber.dispose()
  })

  it('ignores unrelated volatile paths and records nothing while disabled', async () => {
    const ctx = await boot()
    const agent = await createAgent(ctx, 'disabled-policy')
    await selectionConfigs.get(ctx)!.update({ allowedModels: ALLOWED_MODELS })
    expect(agent.session.snapshotEvents()
      .filter(event => event.type.startsWith('subagent/model-selection-policy'))).toHaveLength(0)

    selectionConfigs.get(ctx)!.fiber.ctx.emit('loader/volatile-update', [['unrelated']])
    expect(agent.session.snapshotEvents()
      .filter(event => event.type.startsWith('subagent/model-selection-policy'))).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('does nothing when the Agent registry is absent', async () => {
    const ctx = ownContext(new Context())
    await ctx.plugin(SessionProjectionRegistry)
    const configs = await liveConfig(ctx, SubagentModelSelectionConfig, {
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    await configs.update({ enabled: false })
    await ctx.fiber.dispose()
  })

  it('enforces a changed preference before the next delegation', async () => {
    const ctx = await boot()
    await selectionConfigs.get(ctx)!.update({ enabled: true, allowedModels: ALLOWED_MODELS })
    const agent = await createAgent(ctx, 'dynamic-enforcement')
    const args = {
      description: 'dynamic route',
      prompt: 'do it',
      provider: 'alpha',
      model: 'other-model',
    }

    const denied = await executeToolFixture(ctx, {
      signal: new AbortController().signal,
      callId: ToolCallId('dynamic-route-denied'),
      name: 'subagent',
      arguments: args,
      agent,
    })
    expect(denied.isError).toBe(true)
    expect(text(denied)).toContain('is not allowed for this Session')

    await selectionConfigs.get(ctx)!.update({
      enabled: true,
      allowedModels: [{ provider: 'alpha', model: 'other-model' }],
    })
    const nowAuthorized = await executeToolFixture(ctx, {
      signal: new AbortController().signal,
      callId: ToolCallId('dynamic-route-authorized'),
      name: 'subagent',
      arguments: args,
      agent,
    })
    expect(nowAuthorized.isError).toBe(true)
    expect(text(nowAuthorized)).not.toContain('is not allowed for this Session')
    await ctx.fiber.dispose()
  })

  it('applies context windows to child Agents live without touching top-level Agents', async () => {
    const ctx = await boot()
    const route = { provider: 'alpha', model: 'fast-model', contextWindow: 64_000 }
    const otherRoute = { provider: 'beta', model: 'slow-model', contextWindow: 16_000 }
    await selectionConfigs.get(ctx)!.update({ enabled: true, allowedModels: [route, otherRoute] })
    const parent = await createAgent(ctx, 'context-parent', {
      agentOptions: { provider: 'alpha', model: 'fast-model' },
    })
    const child = await createAgent(ctx, 'context-child', {
      meta: { parentSession: parent.id, origin: 'subagent' },
      agentOptions: { provider: 'alpha', model: 'fast-model' },
    })

    expect(parent.contextWindow).toBeUndefined()
    expect(child.contextWindow).toBe(64_000)
    await selectionConfigs.get(ctx)!.update({
      enabled: true,
      allowedModels: [{ ...route, contextWindow: 32_000 }, otherRoute],
    })
    expect(child.contextWindow).toBe(32_000)
    child.model.select({ provider: 'beta', model: 'slow-model' })
    expect(child.contextWindow).toBe(16_000)
    await selectionConfigs.get(ctx)!.update({ enabled: true, allowedModels: [route] })
    expect(child.contextWindow).toBe(16_000)
    await selectionConfigs.get(ctx)!.update({ enabled: false })
    expect(child.contextWindow).toBe(16_000)
    const unconfigured = await createAgent(ctx, 'context-unconfigured', {
      meta: { parentSession: parent.id, origin: 'subagent' },
    })
    expect(unconfigured.contextWindow).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('applies a recorded route context window to a restored child Agent', async () => {
    const ctx = await boot()
    const route = { provider: 'alpha', model: 'fast-model', contextWindow: 48_000 }
    await selectionConfigs.get(ctx)!.update({ enabled: true, allowedModels: [route] })
    const seed = Session.create(SessionId('context-window-seed'))
    seed.append('subagent/model-selection-policy', { allowedModels: [route] })
    const parent = await createAgent(ctx, 'context-restore-parent')
    const restored = await createAgent(ctx, 'context-restored', {
      meta: { parentSession: parent.id, origin: 'subagent' },
      seed: seed.snapshotEvents(),
      agentOptions: { provider: 'alpha', model: 'fast-model' },
    })
    expect(restored.contextWindow).toBe(48_000)
    await ctx.fiber.dispose()
  })

  it('ignores model selections from Sessions without a live Agent', async () => {
    const ctx = await boot()
    await selectionConfigs.get(ctx)!.update({ enabled: true, allowedModels: ALLOWED_MODELS })
    ctx.emit(
      'session/event',
      Session.create(SessionId('detached-selection')),
      {
        type: 'model/selection',
        seq: SessionSeq(0),
        time: 0,
        data: { provider: 'alpha', model: 'fast-model' },
      } satisfies SessionEvent<'model/selection'>,
    )
    await ctx.fiber.dispose()
  })

  it('permits independently configured delegation tools without a settings service', async () => {
    const ctx = ownContext(new Context())
    await mountAgentLoopTestDependencies(ctx)
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
    await ctx.plugin(tool, { provider: 'spawn', modelSelection: true })
    await ctx.plugin(tool, { provider: 'spawn', toolName: 'another_spawn', modelSelection: true })
    expect(ctx.tools.get('subagent')).toBeDefined()
    expect(ctx.tools.get('another_spawn')).toBeDefined()
    expect(ctx.tools.get('list_subagent_models')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

it('reads the saved default depth at each delegation without remounting the tool', async () => {
  const ctx = await boot(false)
  const depths: Array<number | undefined> = []
  try {
    ctx.subagents.registerProvider({
      name: 'capture-depth',
      capabilities: { agentOptions: true, agentPreset: false, outputSchema: true, depthLimit: true },
      inheritsParentContext: false,
      start: async (request) => {
        depths.push(request.maxDepth)
        return { id: SessionId(`depth-${depths.length}`),
          result: Promise.resolve({ output: [], stopReason: 'completed' as const }), dispose: async () => {} }
      },
    })
    await ctx.plugin(tool, { provider: 'capture-depth' })
    const { agent } = await ctx.agents.create({ sessionId: SessionId('live-depth-context') })
    const initial = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(initial.contexts.find(part => part.name === 'tool:subagent:depth')?.text)
      .toBe('')
    await callSubagent(ctx, { description: 'first', prompt: 'work' })
    await subagentConfigs.get(ctx)!.update({ maxDepth: 5 })
    const updated = ctx.systemPrompt.refreshContext(initial, assembleContextFor(agent))
    expect(updated.contexts.find(part => part.name === 'tool:subagent:depth')?.text)
      .toBe('')
    await callSubagent(ctx, { description: 'second', prompt: 'work' })
    await subagentConfigs.get(ctx)!.update({ maxDepth: 0 })
    const disabled = ctx.systemPrompt.refreshContext(initial, assembleContextFor(agent))
    expect(disabled.contexts.find(part => part.name === 'tool:subagent:depth')?.text)
      .toBe('Delegation depth for `subagent`: current 0, maximum 0, remaining levels 0. Do not call `subagent` at this depth; carry out the work directly.')
    expect(disabled.sections).toEqual(initial.sections)
    expect(disabled.tools).toEqual(initial.tools)
    await subagentConfigs.get(ctx)!.update({ maxDepth: 2 })
    expect(ctx.systemPrompt.refreshContext(disabled, assembleContextFor(agent))
      .contexts.find(part => part.name === 'tool:subagent:depth')?.text).toBe('')
    await subagentConfigs.get(ctx)!.update({ maxDepth: 0 })
    await callSubagent(ctx, { description: 'disabled', prompt: 'work' })
    expect(depths).toEqual([1, 5, 0])
  } finally {
    await ctx.fiber.dispose()
  }
})
