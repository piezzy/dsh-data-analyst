/**
 * Optional live LLM smoke test (M11).
 *
 * Composition root: this is the ONLY place that reads DSH_LLM_* env vars.
 * Core investigation/policy code never touches process.env.
 *
 * - No key → prints the skip message, exits 0 (CI stays green).
 * - Key present → one real DeepSeek decision through LLMInvestigationPolicy;
 *   asserts only a valid Tier 1 decision kind, never exact wording.
 */
import { DeepSeekClient } from './dist/loop/providers/deepseek-client.js';
import { LLMInvestigationPolicy } from './dist/loop/llm-policy.js';

const TIER1_KINDS = new Set(['STOP', 'TEST_NEXT', 'REFINE']);

async function main() {
  const apiKey = (process.env.DSH_LLM_API_KEY ?? '').trim();
  if (apiKey === '') {
    console.log('LLM smoke skipped (no DSH_LLM_API_KEY)');
    return;
  }

  const client = new DeepSeekClient({
    apiKey,
    ...(process.env.DSH_LLM_BASE_URL !== undefined && process.env.DSH_LLM_BASE_URL !== ''
      ? { baseUrl: process.env.DSH_LLM_BASE_URL }
      : {}),
    ...(process.env.DSH_LLM_MODEL !== undefined && process.env.DSH_LLM_MODEL !== ''
      ? { model: process.env.DSH_LLM_MODEL }
      : {}),
  });
  const policy = new LLMInvestigationPolicy(client, { timeoutMs: 60000 });

  const decision = await policy.decide({
    goal: 'Compare North vs South revenue',
    round: 1,
    maxRounds: 5,
    maxEvidence: 12,
    hypotheses: [
      { id: 'H1', statement: 'North revenue is higher than South revenue.', status: 'testing' },
    ],
    pendingPlans: 0,
    evidenceCount: 1,
    lastVerdict: 'inconclusive',
    lastAnalysisType: 'compare',
    consecutiveRoundsWithoutEvidence: 0,
    profileSummary: {
      columns: [
        { name: 'date', type: 'date', nullable: false, missingCount: 0 },
        { name: 'region', type: 'string', nullable: false, missingCount: 0, topValues: ['North', 'South', 'East', 'West'] },
        { name: 'revenue', type: 'number', nullable: true, missingCount: 3 },
      ],
    },
    evidenceSummaries: [
      { evidenceId: 'evidence-001', operation: 'compare', round: 1, digest: 'North vs South, 1 row', resultRows: 1 },
    ],
  });

  // Never log prompts, responses, or keys — only the closed-vocabulary kind.
  console.log(`Live decision kind: ${decision.kind}`);
  if (!TIER1_KINDS.has(decision.kind)) {
    throw new Error(`Invalid Tier 1 decision kind: ${String(decision.kind)}`);
  }
  console.log('=== LLM SMOKE PASSED ===');
}

main().catch((error) => {
  console.error('LLM SMOKE FAILED');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
