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
import { resetCounters } from "../src/utils/id-generator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.join(__dirname, "fixtures", "sales-2024.csv");

const noopExec = {} as any;

const throwingEngine = {
  aggregate: async () => {
    throw new Error("report must not run analysis");
  },
  compare: async () => {
    throw new Error("report must not run analysis");
  },
  trend: async () => {
    throw new Error("report must not run analysis");
  },
};

/**
 * M13.3 — deterministic limitation rules. Every rule reads recorded
 * state only: finding outcomes, hypothesis terminal states, the
 * caller-recorded trend `unfilteredPeriod` marker, and caller-provided
 * profiling counts. No LLM, no analysis, no invented content.
 */
describe("M13.3 deterministic report limitations", () => {
  let investigationService: InvestigationService;
  let evidenceService: EvidenceService;
  let findingService: FindingService;
  let verificationService: VerificationService;
  let reportService: ReportService;

  beforeEach(() => {
    resetCounters();
    investigationService = new InvestigationService();
    evidenceService = new EvidenceService(investigationService);
    findingService = new FindingService(investigationService, evidenceService);
    verificationService = new VerificationService(
      investigationService,
      evidenceService,
      findingService,
      throwingEngine as any,
    );
    reportService = new ReportService(
      investigationService,
      evidenceService,
      findingService,
      verificationService,
    );
  });

  const recordFindingWith = (
    invId: string,
    status: "verified" | "rejected" | "unverified",
  ) => {
    const ev = evidenceService.recordEvidence(
      invId,
      "comparison",
      "compare",
      { datasetId: "dataset-001" },
      { baseValue: 2, compareValue: 1 },
    );
    const finding = findingService.recordFinding(invId, "B exceeds A.", [
      ev.id,
    ]);
    finding.verificationStatus = status;
    return { ev, finding };
  };

  it("reports no limitations for a clean verified investigation", () => {
    const inv = investigationService.createInvestigation(
      "dataset-001",
      "Compare A vs B",
    );
    const h = investigationService.addHypothesis(inv.investigationId, "A wins.");
    investigationService.setHypothesisStatus(
      inv.investigationId,
      h.id,
      "supported",
    );
    recordFindingWith(inv.investigationId, "verified");
    const report = reportService.generateReport(inv.investigationId);
    expect(report.limitations).toEqual([]);
  });

  it("flags rejected findings without changing verified ones", () => {
    const inv = investigationService.createInvestigation(
      "dataset-001",
      "Compare A vs B",
    );
    recordFindingWith(inv.investigationId, "rejected");
    const report = reportService.generateReport(inv.investigationId);
    expect(report.limitations).toHaveLength(1);
    expect(report.limitations[0]).toContain("rejected");
    expect(report.limitations[0]).toContain("should not be treated");
  });

  it("flags inconclusive hypotheses; decided ones stay silent", () => {
    const inv = investigationService.createInvestigation(
      "dataset-001",
      "Analyze",
    );
    const inconclusive = investigationService.addHypothesis(
      inv.investigationId,
      "Maybe.",
    );
    investigationService.setHypothesisStatus(
      inv.investigationId,
      inconclusive.id,
      "inconclusive",
    );
    const supported = investigationService.addHypothesis(
      inv.investigationId,
      "Surely.",
    );
    investigationService.setHypothesisStatus(
      inv.investigationId,
      supported.id,
      "supported",
    );
    const rejected = investigationService.addHypothesis(
      inv.investigationId,
      "Nope.",
    );
    investigationService.setHypothesisStatus(
      inv.investigationId,
      rejected.id,
      "rejected",
    );
    const report = reportService.generateReport(inv.investigationId);
    expect(report.limitations).toHaveLength(1);
    expect(report.limitations[0]).toContain("H1");
    expect(report.limitations[0]).toContain("inconclusive");
  });

  it("surfaces the unfiltered-period marker once per period", () => {
    const inv = investigationService.createInvestigation(
      "dataset-001",
      "Trend in Q3",
    );
    for (const operation of ["trend", "trend"] as const) {
      evidenceService.recordEvidence(
        inv.investigationId,
        "statistic",
        operation,
        {
          datasetId: "dataset-001",
          timeColumn: "date",
          valueColumn: "revenue",
          func: "mean",
          unfilteredPeriod: "Q3",
        },
        [{ date: "2024-01-01", value: 1 }],
      );
    }
    evidenceService.recordEvidence(
      inv.investigationId,
      "comparison",
      "aggregate",
      { datasetId: "dataset-001" },
      [{ product: "A", mean: 1 }],
    );
    const report = reportService.generateReport(inv.investigationId);
    const periodEntries = report.limitations.filter((l) =>
      l.includes("full data range"),
    );
    expect(periodEntries).toHaveLength(1);
    expect(periodEntries[0]).toContain("Q3");
  });

  it("ignores blank or non-string period markers", () => {
    const inv = investigationService.createInvestigation(
      "dataset-001",
      "Trend",
    );
    evidenceService.recordEvidence(
      inv.investigationId,
      "statistic",
      "trend",
      { datasetId: "dataset-001", unfilteredPeriod: "   " },
      [],
    );
    evidenceService.recordEvidence(
      inv.investigationId,
      "statistic",
      "trend",
      { datasetId: "dataset-001", unfilteredPeriod: 42 },
      [],
    );
    const report = reportService.generateReport(inv.investigationId);
    expect(report.limitations).toEqual([]);
  });

  it("renders duplicate-row counts; zero or absent stays silent", () => {
    const inv = investigationService.createInvestigation(
      "dataset-001",
      "Analyze",
    );
    expect(
      reportService.generateReport(inv.investigationId).limitations,
    ).toEqual([]);
    expect(
      reportService.generateReport(inv.investigationId, { duplicateRows: 0 })
        .limitations,
    ).toEqual([]);
    const report = reportService.generateReport(inv.investigationId, {
      duplicateRows: 20,
    });
    expect(report.limitations).toHaveLength(1);
    expect(report.limitations[0]).toContain("20 duplicate rows");
  });

  it("renders one entry per column with missing values, in order", () => {
    const inv = investigationService.createInvestigation(
      "dataset-001",
      "Analyze",
    );
    expect(
      reportService.generateReport(inv.investigationId, {
        missingValues: { revenue: 0, quantity: 0 },
      }).limitations,
    ).toEqual([]);
    const report = reportService.generateReport(inv.investigationId, {
      missingValues: { date: 0, revenue: 24, quantity: 16 },
    });
    expect(report.limitations).toHaveLength(2);
    expect(report.limitations[0]).toContain("revenue");
    expect(report.limitations[0]).toContain("24 missing values");
    expect(report.limitations[1]).toContain("quantity");
    expect(report.limitations[1]).toContain("16 missing values");
  });

  it("is deterministic across generations", () => {
    const inv = investigationService.createInvestigation(
      "dataset-001",
      "Analyze",
    );
    const h = investigationService.addHypothesis(inv.investigationId, "Maybe.");
    investigationService.setHypothesisStatus(
      inv.investigationId,
      h.id,
      "inconclusive",
    );
    recordFindingWith(inv.investigationId, "unverified");
    const ctx = {
      duplicateRows: 20,
      missingValues: { revenue: 24, quantity: 16 },
    };
    const first = reportService.generateReport(inv.investigationId, ctx);
    const second = reportService.generateReport(inv.investigationId, ctx);
    expect(second.limitations).toEqual(first.limitations);
    expect(first.limitations).toHaveLength(1 + 1 + 1 + 2);
  });

  it("markdown renders entries and keeps the empty case", () => {
    const renderer = new MarkdownReportRenderer();
    const inv = investigationService.createInvestigation(
      "dataset-001",
      "Analyze",
    );
    recordFindingWith(inv.investigationId, "unverified");
    const withLimits = reportService.generateReport(inv.investigationId, {
      duplicateRows: 20,
    });
    const md = renderer.render(withLimits);
    expect(md).toContain("## Limitations");
    expect(md).toContain("unverified");
    expect(md).toContain("20 duplicate rows");

    resetCounters();
    const freshInvestigationService = new InvestigationService();
    const freshEvidenceService = new EvidenceService(freshInvestigationService);
    const freshFindingService = new FindingService(
      freshInvestigationService,
      freshEvidenceService,
    );
    const freshVerificationService = new VerificationService(
      freshInvestigationService,
      freshEvidenceService,
      freshFindingService,
      throwingEngine as any,
    );
    const freshReportService = new ReportService(
      freshInvestigationService,
      freshEvidenceService,
      freshFindingService,
      freshVerificationService,
    );
    const clean = freshInvestigationService.createInvestigation(
      "dataset-001",
      "Analyze",
    );
    const cleanMd = renderer.render(
      freshReportService.generateReport(clean.investigationId),
    );
    expect(cleanMd).toContain("None identified.");
  });

  describe("sales-2024 agent integration", () => {
    const makeToolStack = () => {
      resetCounters();
      const registry = new LoaderRegistry();
      registry.register(new CsvLoader());
      const datasetService = new DatasetService(registry);
      const inv = new InvestigationService();
      const ev = new EvidenceService(inv);
      const fs = new FindingService(inv, ev);
      const engine = new NativeAnalysisEngine(datasetService);
      const vs = new VerificationService(inv, ev, fs, engine);
      const rs = new ReportService(inv, ev, fs, vs);
      const md = new MarkdownReportRenderer();
      const tool = defineAgentInvestigationTool({
        datasetService,
        investigationService: inv,
        evidenceService: ev,
        findingService: fs,
        verificationService: vs,
        analysisEngine: engine,
        reportService: rs,
        markdownRenderer: md,
      });
      return { tool };
    };

    it("surfaces duplicates and missing values on the realistic fixture", async () => {
      const { tool } = makeToolStack();
      const result = (await tool.execute(
        {
          path: FIXTURE,
          goal: "Compare North vs South revenue",
          max_hypotheses: 1,
        },
        noopExec,
      )) as any;
      expect(result.status).toBe("completed");
      const limitations: string[] = result.report.structured.limitations;
      expect(limitations.some((l) => l.includes("20 duplicate rows"))).toBe(
        true,
      );
      expect(
        limitations.some(
          (l) => l.includes("revenue") && l.includes("24 missing values"),
        ),
      ).toBe(true);
      expect(
        limitations.some(
          (l) => l.includes("quantity") && l.includes("16 missing values"),
        ),
      ).toBe(true);
      expect(result.report.markdown).toContain("20 duplicate rows");
      expect(result.verificationDetails.status).toBe("verified");
    });

    it("surfaces the unfiltered-period caveat for a period goal", async () => {
      const { tool } = makeToolStack();
      const result = (await tool.execute(
        {
          path: FIXTURE,
          goal: "Show the revenue trend in Q3",
          max_hypotheses: 1,
        },
        noopExec,
      )) as any;
      expect(result.status).toBe("completed");
      const limitations: string[] = result.report.structured.limitations;
      expect(
        limitations.some(
          (l) => l.includes("Q3") && l.includes("full data range"),
        ),
      ).toBe(true);
      expect(result.verificationDetails.status).toBe("verified");
    });
  });
});
