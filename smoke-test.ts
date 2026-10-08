/**
 * Standalone runtime smoke test for the dsh-data-analyst DSH plugin.
 *
 * Boot order follows the dependency chain found in the installed sources:
 *
 *   SystemPrompt  (provides "systemPrompt"; no inject)
 *     → ToolRegistry  (static inject = ["systemPrompt"]; provides "tools")
 *       → dsh-data-analyst  (inject = ["tools"])
 *         → smoke plugin    (inject = ["tools"])
 *
 * Cordis lifecycle note (cordis/src/fiber.ts): `await ctx.plugin(p)` settles
 * as soon as the fiber's current lifecycle work settles — a fiber whose
 * required services are missing NEVER starts its lifecycle (inertia stays
 * undefined), so the await resolves immediately while the fiber remains
 * PENDING and apply() never runs, with no error. Each registration below is
 * therefore verified to reach ACTIVE before the next one begins.
 */
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime as ToolRegistry } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import {
  name as pluginName,
  inject as pluginInject,
  apply as applyPlugin,
} from './dist/index.js';

/** FiberState.ACTIVE (cordis FiberState: PENDING=0, LOADING=1, ACTIVE=2, ...). */
const FIBER_STATE_ACTIVE = 2;
const FIBER_STATE_NAMES = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'];

const EXPECTED_TOOLS = [
  'inspect_dataset',
  'start_investigation',
  'add_hypothesis',
  'transition_investigation',
  'record_evidence',
  'get_investigation',
  'record_finding',
  'verify_finding',
  'get_finding',
  'run_investigation',
];

/**
 * Register a plugin and only proceed once its fiber is ACTIVE, so a missing
 * dependency fails loudly here instead of silently skipping apply().
 */
async function register(label: string, ctx: Context, plugin: any) {
  const fiber = ctx.plugin(plugin);
  await fiber;
  for (let i = 0; fiber.state !== FIBER_STATE_ACTIVE; i++) {
    if (i >= 200) {
      throw new Error(
        `${label} did not reach ACTIVE (state=${FIBER_STATE_NAMES[fiber.state] ?? fiber.state}) ` +
          '— a required service was never provided',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  console.log(`${label} loaded`);
  return fiber;
}

async function main() {
  console.log('=== BOOT ===');

  const ctx = new Context();

  console.log('Registering SystemPrompt...');
  await register('SystemPrompt', ctx, SystemPrompt);

  console.log('Registering ToolRegistry...');
  await register('ToolRegistry', ctx, ToolRegistry);

  console.log('Registering dsh-data-analyst...');
  await register('dsh-data-analyst', ctx, {
    name: pluginName,
    inject: pluginInject,
    apply: applyPlugin,
  });

  let executionPromise: Promise<void> | undefined;

  const smokeTestPlugin = {
    name: 'dsh-data-analyst-smoke-test',
    inject: ['tools'],

    apply(smokeCtx: Context) {
      console.log('=== SMOKE PLUGIN STARTED ===');

      const tools = (smokeCtx as any).tools;

      console.log('=== REGISTERED TOOLS ===');
      const schemas = tools.schemas();
      for (const schema of schemas) {
        console.log(`- ${schema.name}`);
      }
      console.log(`\nTotal tools: ${schemas.length}`);

      const registered = schemas.map((schema: { name: string }) => schema.name);
      for (const expected of EXPECTED_TOOLS) {
        if (!registered.includes(expected)) {
          throw new Error(`missing tool: ${expected}`);
        }
      }
      if (schemas.length !== EXPECTED_TOOLS.length) {
        throw new Error(
          `expected exactly ${EXPECTED_TOOLS.length} tools, got ${schemas.length}`,
        );
      }

      const tool = tools.get('run_investigation');
      if (!tool) {
        throw new Error('run_investigation was not registered');
      }
      console.log('\n✓ run_investigation found');

      executionPromise = tools
        .execute({
          callId: 'smoke-test-001',
          name: 'run_investigation',
          arguments: {
            path: 'tests/fixtures/sample.csv',
            goal: 'Compare Jakarta vs Surabaya revenue',
            max_hypotheses: 1,
          },
          signal: new AbortController().signal,
        })
        .then((result: { isError: boolean; value?: any }) => {
          if (result.isError) {
            throw new Error(`run_investigation returned isError: ${JSON.stringify(result)}`);
          }
          const value = result.value;
          if (!value || typeof value !== 'object') {
            throw new Error('run_investigation result has no canonical value');
          }

          const problems: string[] = [];
          if (value.status !== 'completed') problems.push(`status=${value.status}`);
          if (typeof value.investigationId !== 'string') problems.push('no investigationId');
          if (!(value.evidenceCount > 0)) problems.push('no evidence');
          if (!Array.isArray(value.findings) || value.findings.length === 0) {
            problems.push('no findings');
          }
          if (!value.verificationDetails) problems.push('no verificationDetails');
          if (!value.report || !value.report.structured) problems.push('no report.structured');
          if (typeof (value.report && value.report.markdown) !== 'string') {
            problems.push('no report.markdown');
          }
          if (problems.length > 0) {
            throw new Error(`result incomplete: ${problems.join(', ')}`);
          }

          console.log('\n=== RESULT ===');
          console.log(`status:              ${value.status}`);
          console.log(`investigationId:     ${value.investigationId}`);
          console.log(`evidenceCount:       ${value.evidenceCount}`);
          console.log(
            `findings:            ${value.findings.length} (${value.findings[0].verificationStatus})`,
          );
          console.log(`verification status: ${value.verificationDetails.status}`);
          console.log(`report.structured:   ${Object.keys(value.report.structured).join(', ')}`);
          console.log(
            `report.markdown:     ${value.report.markdown.length} chars, first line: "${value.report.markdown.split('\n')[0]}"`,
          );
        })
        .catch((error: unknown) => {
          console.error('\n❌ TOOL EXECUTION FAILED');
          console.error(error);
          throw error;
        });
    },
  };

  console.log('Registering smoke-test plugin...');
  await register('dsh-data-analyst-smoke-test', ctx, smokeTestPlugin);

  console.log('Waiting for tool execution...');
  if (!executionPromise) {
    throw new Error('Smoke plugin did not start');
  }
  await executionPromise;

  console.log('\n=== SMOKE TEST PASSED ===');

  await ctx.fiber.dispose();
}

main().catch((error) => {
  console.error('\n❌ SMOKE TEST FAILED');
  console.error(error);
  process.exit(1);
});

