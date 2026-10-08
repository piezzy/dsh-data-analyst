import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LoaderRegistry } from "../src/formats/loader.js";
import { CsvLoader } from "../src/formats/csv-loader.js";
import { DatasetService } from "../src/services/dataset-service.js";
import { ProfilingService } from "../src/services/profiling-service.js";
import { InvestigationService } from "../src/services/investigation-service.js";
import { EvidenceService } from "../src/services/evidence-service.js";
import { FindingService } from "../src/services/finding-service.js";
import { VerificationService } from "../src/services/verification-service.js";
import { ReportService } from "../src/services/report-service.js";
import { MarkdownReportRenderer } from "../src/services/markdown-report-renderer.js";
import { NativeAnalysisEngine } from "../src/engines/native-engine.js";
import {
  defineAgentInvestigationTool,
  parseGoalIntent,
} from "../src/tools/agent-investigation.js";
import { resetCounters } from "../src/utils/id-generator.js";
import { deepEqual } from "../src/utils/deep-equal.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.join(__dirname, "fixtures", "sales-2024.csv");

const noopExec = {} as any;

const GOAL_COMPARE = "Compare North vs South revenue";
const GOAL_AGGREGATE = "What is the average revenue by product?";
const GOAL_TREND = "Show the revenue trend over time";

interface Stack {
  datasetService: DatasetService;
  investigationService: InvestigationService;
  evidenceService: EvidenceService;
  findingService: FindingService;
  verificationService: VerificationService;
  engine: NativeAnalysisEngine;
  reportService: ReportService;
  markdownRenderer: MarkdownReportRenderer;
}

function makeStack(): Stack {
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
  return {
    datasetService,
    investigationService,
    evidenceService,
    findingService,
    verificationService,
    engine,
    reportService,
    markdownRenderer,
  };
}

function makeTool(stack: Stack) {
  return defineAgentInvestigationTool({
    datasetService: stack.datasetService,
    investigationService: stack.investigationService,
    evidenceService: stack.evidenceService,
    findingService: stack.findingService,
    verificationService: stack.verificationService,
    analysisEngine: stack.engine,
    reportService: stack.reportService,
    markdownRenderer: stack.markdownRenderer,
  });
}

async function loadProfile() {
  resetCounters();
  const registry = new LoaderRegistry();
  registry.register(new CsvLoader());
  const datasetService = new DatasetService(registry);
  const dataset = await datasetService.loadDataset(FIXTURE);
  const profile = new ProfilingService().profile(dataset);
  return { datasetService, dataset, profile };
}

/** Round like the agent's claim formatter (2 decimals). */
function fmtNum(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/**
 * M8 — Realistic end-to-end validation on sales-2024.csv (1020 rows,
 * deterministic seed-42 fixture: date/region/product/revenue/quantity
 * with missing values and duplicate rows).
 */
describe("M8 realistic end-to-end investigation", () => {
  beforeEach(() => {
    resetCounters();
  });

  describe("fixture inspection (dataset inspection stage)", () => {
    it("loads ~1000+ rows with the expected schema", async () => {
      const { dataset, profile } = await loadProfile();
      expect(dataset.data.length).toBeGreaterThanOrEqual(1000);
      expect(profile.metadata.rows).toBe(dataset.data.length);
      expect(profile.metadata.columns).toBe(5);
      const byName = Object.fromEntries(
        profile.metadata.schema.map((s) => [s.name, s]),
      );
      expect(byName["date"]?.type).toBe("date");
      expect(byName["region"]?.type).toBe("string");
      expect(byName["product"]?.type).toBe("string");
      expect(byName["revenue"]?.type).toBe("number");
      expect(byName["quantity"]?.type).toBe("number");
      expect(byName["revenue"]?.nullable).toBe(true);
      expect(byName["quantity"]?.nullable).toBe(true);
    });

    it("exposes data-quality signals: missing values and duplicates", async () => {
      const { profile } = await loadProfile();
      expect(profile.missingValues["revenue"]).toBeGreaterThan(0);
      expect(profile.missingValues["quantity"]).toBeGreaterThan(0);
      expect(profile.missingValues["date"]).toBe(0);
      expect(profile.duplicateRows).toBeGreaterThanOrEqual(20);
    });

    it("contains multiple groups per categorical dimension", async () => {
      const { profile } = await loadProfile();
      const regions =
        profile.columnProfiles["region"]?.categoricalStats?.topValues ?? [];
      const products =
        profile.columnProfiles["product"]?.categoricalStats?.topValues ?? [];
      for (const r of ["North", "South", "East", "West"]) {
        expect(regions).toContain(r);
      }
      for (const p of ["Widget A", "Widget B", "Widget C"]) {
        expect(products).toContain(p);
      }
    });
  });

  describe("goal parsing on the realistic fixture", () => {
    it("parses the compare goal", async () => {
      const { profile } = await loadProfile();
      const intent = parseGoalIntent(GOAL_COMPARE, profile);
      expect(intent.analysisType).toBe("compare");
      expect(intent.metric).toBe("revenue");
      expect(intent.groupColumn).toBe("region");
      expect(intent.baseGroup).toBe("North");
      expect(intent.compareGroup).toBe("South");
      expect(intent.confidence).toBeGreaterThan(0.5);
    });

    it("parses the aggregate goal", async () => {
      const { profile } = await loadProfile();
      const intent = parseGoalIntent(GOAL_AGGREGATE, profile);
      expect(intent.analysisType).toBe("aggregate");
      expect(intent.metric).toBe("revenue");
      expect(intent.groupColumn).toBe("product");
      expect(intent.confidence).toBeGreaterThan(0.5);
    });

    it("parses the trend goal", async () => {
      const { profile } = await loadProfile();
      const intent = parseGoalIntent(GOAL_TREND, profile);
      expect(intent.analysisType).toBe("trend");
      expect(intent.metric).toBe("revenue");
      expect(intent.groupColumn).toBe("date");
      expect(intent.confidence).toBeGreaterThan(0.5);
    });
  });

  describe("run_investigation end to end", () => {
    it("compare: completes with verified evidence-backed finding", async () => {
      const stack = makeStack();
      const result = (await makeTool(stack).execute(
        { path: FIXTURE, goal: GOAL_COMPARE, max_hypotheses: 1 },
        noopExec,
      )) as any;
      expect(result.status).toBe("completed");
      expect(result.hypotheses).toHaveLength(1);
      expect(result.hypotheses[0].statement).toContain("North");
      expect(result.hypotheses[0].statement).toContain("South");
      expect(result.evidenceCount).toBe(1);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].verificationStatus).toBe("verified");
      expect(result.verificationDetails.status).toBe("verified");
      expect(
        result.verificationDetails.checkedEvidence.every(
          (e: any) => e.reproducible === true && e.matches === true,
        ),
      ).toBe(true);
    });

    it("aggregate: completes across product and region groupings", async () => {
      const stack = makeStack();
      const result = (await makeTool(stack).execute(
        { path: FIXTURE, goal: GOAL_AGGREGATE, max_hypotheses: 2 },
        noopExec,
      )) as any;
      expect(result.status).toBe("completed");
      expect(result.hypotheses).toHaveLength(2);
      expect(result.evidenceCount).toBe(2);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].verificationStatus).toBe("verified");
      expect(result.verificationDetails.checkedEvidence).toHaveLength(2);
      expect(
        result.verificationDetails.checkedEvidence.every(
          (e: any) => e.matches === true,
        ),
      ).toBe(true);
    });

    it("trend: completes over the date column", async () => {
      const stack = makeStack();
      const result = (await makeTool(stack).execute(
        { path: FIXTURE, goal: GOAL_TREND, max_hypotheses: 1 },
        noopExec,
      )) as any;
      expect(result.status).toBe("completed");
      expect(result.hypotheses).toHaveLength(1);
      expect(result.hypotheses[0].statement).toContain("over time");
      expect(result.evidenceCount).toBe(1);
      expect(result.findings[0].verificationStatus).toBe("verified");
      expect(result.verificationDetails.status).toBe("verified");
    });
  });

  describe("findings are factual (derived from actual evidence)", () => {
    it("compare claim restates the recorded evidence numbers", async () => {
      const stack = makeStack();
      const result = (await makeTool(stack).execute(
        { path: FIXTURE, goal: GOAL_COMPARE, max_hypotheses: 1 },
        noopExec,
      )) as any;
      const claim: string = result.findings[0].claim;
      const recorded = result.verificationDetails.checkedEvidence[0]
        .recordedResult as any;
      expect(recorded.baseGroup).toBe("North");
      expect(recorded.compareGroup).toBe("South");
      expect(claim).toContain("North");
      expect(claim).toContain("South");
      expect(claim).toContain(fmtNum(recorded.baseValue));
      expect(claim).toContain(fmtNum(recorded.compareValue));
    });

    it("aggregate claim names the real min/max groups from evidence", async () => {
      const stack = makeStack();
      const result = (await makeTool(stack).execute(
        { path: FIXTURE, goal: GOAL_AGGREGATE, max_hypotheses: 1 },
        noopExec,
      )) as any;
      const claim: string = result.findings[0].claim;
      const recorded = result.verificationDetails.checkedEvidence[0]
        .recordedResult as any[];
      expect(Array.isArray(recorded)).toBe(true);
      const means = recorded
        .map((r: any) => ({ g: String(r["product"]), v: r["mean"] as number }))
        .filter((e) => Number.isFinite(e.v));
      expect(means.length).toBe(3);
      let mn = means[0]!;
      let mx = means[0]!;
      for (const e of means) {
        if (e.v < mn.v) mn = e;
        if (e.v > mx.v) mx = e;
      }
      expect(claim).toContain(mn.g);
      expect(claim).toContain(mx.g);
      expect(claim).toContain(fmtNum(mn.v));
      expect(claim).toContain(fmtNum(mx.v));
    });

    it("trend claim spans the recorded first/last periods", async () => {
      const stack = makeStack();
      const result = (await makeTool(stack).execute(
        { path: FIXTURE, goal: GOAL_TREND, max_hypotheses: 1 },
        noopExec,
      )) as any;
      const claim: string = result.findings[0].claim;
      const recorded = result.verificationDetails.checkedEvidence[0]
        .recordedResult as any[];
      const rows = recorded.filter(
        (r) => typeof r?.["value"] === "number",
      );
      expect(rows.length).toBeGreaterThan(10);
      const first = rows[0]!;
      const last = rows[rows.length - 1]!;
      expect(claim).toContain(String(first["date"]));
      expect(claim).toContain(String(last["date"]));
      expect(claim).toContain(fmtNum(first["value"]));
      expect(claim).toContain(fmtNum(last["value"]));
    });
  });

  describe("verification reproduces deterministic analysis results", () => {
    it("recorded evidence re-executes to the identical result", async () => {
      const stack = makeStack();
      const result = (await makeTool(stack).execute(
        { path: FIXTURE, goal: GOAL_COMPARE, max_hypotheses: 1 },
        noopExec,
      )) as any;
      const stored = stack.evidenceService.getEvidenceForInvestigation(
        result.investigationId,
      );
      expect(stored).toHaveLength(result.evidenceCount);
      for (const ev of stored) {
        let reproduced: any;
        if (ev.operation === "compare") {
          reproduced = (await stack.engine.compare(ev.input as any)).result;
        } else if (ev.operation === "aggregate") {
          reproduced = (await stack.engine.aggregate(ev.input as any)).result;
        } else {
          reproduced = (await stack.engine.trend(ev.input as any)).result;
        }
        expect(deepEqual(ev.result, reproduced)).toBe(true);
      }
    });

    it("re-verification is idempotent", async () => {
      const stack = makeStack();
      const result = (await makeTool(stack).execute(
        { path: FIXTURE, goal: GOAL_AGGREGATE, max_hypotheses: 1 },
        noopExec,
      )) as any;
      const findingId: string = result.findings[0].id;
      const again =
        await stack.verificationService.verifyFinding(findingId);
      expect(again.status).toBe("verified");
      expect(again.checkedEvidence).toHaveLength(result.evidenceCount);
      expect(again.checkedEvidence.every((e) => e.matches === true)).toBe(
        true,
      );
      expect(again.claim).toBe(result.findings[0].claim);
    });
  });

  describe("report generation on the realistic fixture", () => {
    it("structured report mirrors the run result", async () => {
      const stack = makeStack();
      const result = (await makeTool(stack).execute(
        { path: FIXTURE, goal: GOAL_COMPARE, max_hypotheses: 1 },
        noopExec,
      )) as any;
      const structured = result.report.structured;
      expect(structured.investigation.goal).toBe(GOAL_COMPARE);
      expect(structured.investigation.status).toBe("completed");
      expect(structured.hypotheses).toHaveLength(1);
      expect(structured.evidence).toHaveLength(result.evidenceCount);
      expect(structured.findings).toHaveLength(1);
      expect(structured.findings[0].claim).toBe(result.findings[0].claim);
      expect(structured.verification.verified).toBe(1);
    });

    it("markdown contains the actual finding and all sections", async () => {
      const stack = makeStack();
      const result = (await makeTool(stack).execute(
        { path: FIXTURE, goal: GOAL_AGGREGATE, max_hypotheses: 1 },
        noopExec,
      )) as any;
      const md: string = result.report.markdown;
      for (const section of [
        "# Investigation Report",
        "## Goal",
        "## Hypotheses",
        "## Evidence",
        "## Findings",
        "## Verification",
        "## Summary",
        "## Limitations",
      ]) {
        expect(md).toContain(section);
      }
      expect(md).toContain(GOAL_AGGREGATE);
      expect(md).toContain(result.findings[0].claim);
    });
  });

  describe("data-quality edge cases", () => {
    it("analysis completes despite missing values; engine skips them", async () => {
      const { profile } = await loadProfile();
      const missingRevenue = profile.missingValues["revenue"] ?? 0;
      expect(missingRevenue).toBeGreaterThan(0);
      const stack = makeStack();
      await stack.datasetService.loadDataset(FIXTURE);
      const datasetId = stack.datasetService.listDatasets()[0]!.datasetId;
      const agg = await stack.engine.aggregate({
        datasetId,
        aggregations: [{ column: "revenue", func: "mean", alias: "mean" }],
        groupBy: "region",
      });
      expect(agg.result).toHaveLength(4);
      for (const row of agg.result as any[]) {
        expect(typeof row["mean"]).toBe("number");
      }
    });
  });
});
