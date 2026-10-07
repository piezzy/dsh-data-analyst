import { describe, it, expect, beforeEach, vi } from "vitest";

import { InvestigationService } from "../src/services/investigation-service.js";
import { EvidenceService } from "../src/services/evidence-service.js";
import { FindingService } from "../src/services/finding-service.js";
import { VerificationService } from "../src/services/verification-service.js";
import { ReportService } from "../src/services/report-service.js";
import { InvestigationNotFoundError } from "../src/utils/errors.js";
import { resetCounters } from "../src/utils/id-generator.js";

/**
 * M7.1 report-service tests. The report is a deterministic snapshot
 * of existing investigation state; these tests build completed
 * investigations through the existing services, then assert the
 * report assembles that state without running any new analysis.
 */
describe("ReportService (M7.1)", () => {
  let investigationService: InvestigationService;
  let evidenceService: EvidenceService;
  let findingService: FindingService;
  let verificationService: VerificationService;
  let reportService: ReportService;

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

  const setupCompletedInvestigation = () => {
    const inv = investigationService.createInvestigation(
      "dataset-001",
      "Compare Jakarta vs Surabaya revenue",
    );
    investigationService.transitionTo(inv.investigationId, "investigating");
    const hypothesis = investigationService.addHypothesis(
      inv.investigationId,
      "Jakarta revenue is higher than Surabaya revenue.",
      "Directional comparison from parsed goal intent (region: Jakarta vs Surabaya)",
    );
    investigationService.setHypothesisStatus(
      inv.investigationId,
      hypothesis.id,
      "rejected",
    );
    const evidence = evidenceService.recordEvidence(
      inv.investigationId,
      "comparison",
      "compare",
      {
        datasetId: "dataset-001",
        groupColumn: "region",
        valueColumn: "revenue",
        func: "mean",
        baseGroup: "Jakarta",
        compareGroup: "Surabaya",
      },
      {
        baseGroup: "Jakarta",
        baseValue: 147500.25,
        compareGroup: "Surabaya",
        compareValue: 225000.375,
      },
    );
    const finding = findingService.recordFinding(
      inv.investigationId,
      "Surabaya revenue was 52.5% higher than Jakarta (mean 225000.38 vs 147500.25).",
      [evidence.id],
      { hypothesisIds: [hypothesis.id] },
    );
    finding.verificationStatus = "verified";
    finding.verificationReason =
      "All 1 evidence record(s) were reproduced deterministically and match the recorded results";
    investigationService.transitionTo(inv.investigationId, "verifying");
    investigationService.transitionTo(inv.investigationId, "completed");
    return { inv, hypothesis, evidence, finding };
  };

  it("should generate a report from a completed investigation", () => {
    const { inv } = setupCompletedInvestigation();
    const report = reportService.generateReport(inv.investigationId);
    expect(report.investigation.id).toBe(inv.investigationId);
    expect(report.investigation.goal).toBe(
      "Compare Jakarta vs Surabaya revenue",
    );
    expect(report.investigation.status).toBe("completed");
  });

  it("should contain hypotheses, evidence, findings, verification", () => {
    const { inv, hypothesis, evidence, finding } =
      setupCompletedInvestigation();
    const report = reportService.generateReport(inv.investigationId);
    expect(report.hypotheses).toHaveLength(1);
    expect(report.hypotheses[0]).toMatchObject({
      id: hypothesis.id,
      statement: "Jakarta revenue is higher than Surabaya revenue.",
      status: "rejected",
    });
    expect(report.hypotheses[0]?.rationale).toContain("Jakarta vs Surabaya");
    expect(report.evidence).toHaveLength(1);
    expect(report.evidence[0]).toMatchObject({
      id: evidence.id,
      type: "comparison",
      operation: "compare",
    });
    expect(report.evidence[0]?.input).toEqual(evidence.input);
    expect(report.evidence[0]?.result).toEqual(evidence.result);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      id: finding.id,
      claim: finding.claim,
      verificationStatus: "verified",
    });
    expect(report.verification).toEqual({
      findings: 1,
      verified: 1,
      rejected: 0,
      unverified: 0,
    });
  });

  it("should keep finding references intact", () => {
    const { inv, hypothesis, evidence } = setupCompletedInvestigation();
    const report = reportService.generateReport(inv.investigationId);
    expect(report.findings[0]?.evidenceIds).toEqual([evidence.id]);
    expect(report.findings[0]?.hypothesisIds).toEqual([hypothesis.id]);
    expect(report.findings[0]?.confidence).toBeGreaterThanOrEqual(0);
    expect(report.findings[0]?.confidence).toBeLessThanOrEqual(1);
  });


  it("should derive the summary from existing findings only", () => {
    const { inv } = setupCompletedInvestigation();
    const report = reportService.generateReport(inv.investigationId);
    expect(report.summary).toContain("1 finding");
    expect(report.summary).toContain("verified");
    expect(report.summary).not.toMatch(/because|caused by|due to/i);
  });

  it("should not execute new analysis while generating the report", () => {
    const { inv } = setupCompletedInvestigation();
    const aggregateSpy = vi.spyOn(throwingEngine, "aggregate");
    const compareSpy = vi.spyOn(throwingEngine, "compare");
    const trendSpy = vi.spyOn(throwingEngine, "trend");
    reportService.generateReport(inv.investigationId);
    expect(aggregateSpy).not.toHaveBeenCalled();
    expect(compareSpy).not.toHaveBeenCalled();
    expect(trendSpy).not.toHaveBeenCalled();
  });

  it("should produce equivalent output when generated twice", () => {
    const { inv } = setupCompletedInvestigation();
    const first = reportService.generateReport(inv.investigationId);
    const second = reportService.generateReport(inv.investigationId);
    expect(second).toEqual(first);
  });

  it("should handle empty findings deterministically", () => {
    const inv = investigationService.createInvestigation(
      "dataset-001",
      "Analyze revenue",
    );
    const report = reportService.generateReport(inv.investigationId);
    expect(report.findings).toEqual([]);
    expect(report.summary).toBe("Investigation produced no findings.");
    expect(report.verification).toEqual({
      findings: 0,
      verified: 0,
      rejected: 0,
      unverified: 0,
    });
    expect(report.limitations).toEqual([]);
    expect(reportService.generateReport(inv.investigationId)).toEqual(report);
  });

  it("should flag unverified findings without inventing filler", () => {
    const inv = investigationService.createInvestigation(
      "dataset-001",
      "Analyze revenue",
    );
    investigationService.transitionTo(inv.investigationId, "investigating");
    const evidence = evidenceService.recordEvidence(
      inv.investigationId,
      "calculation",
      "aggregate",
      { datasetId: "dataset-001" },
      [{ mean: 100 }],
    );
    findingService.recordFinding(inv.investigationId, "Mean revenue is 100.", [
      evidence.id,
    ]);
    const report = reportService.generateReport(inv.investigationId);
    expect(report.limitations).toHaveLength(1);
    expect(report.limitations[0]).toContain("unverified");
    expect(report.limitations.join(" ")).not.toMatch(
      /data may contain errors/i,
    );
  });

  it("should throw InvestigationNotFoundError for unknown id", () => {
    expect(() =>
      reportService.generateReport("investigation-999"),
    ).toThrowError(InvestigationNotFoundError);
  });
});
