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
const fixturesDir = path.join(__dirname, "fixtures");

const noopExec = {} as any;

/**
 * M7.3 integration tests: run_investigation must append the final
 * report (structured + markdown) after verification, using the
 * existing ReportService and MarkdownReportRenderer.
 */
describe("M7.3 run_investigation report integration", () => {
  let datasetService: DatasetService;
  let investigationService: InvestigationService;
  let evidenceService: EvidenceService;
  let findingService: FindingService;
  let verificationService: VerificationService;
  let engine: NativeAnalysisEngine;
  let reportService: ReportService;
  let markdownRenderer: MarkdownReportRenderer;

  beforeEach(async () => {
    resetCounters();
    const registry = new LoaderRegistry();
    registry.register(new CsvLoader());
    datasetService = new DatasetService(registry);
    await datasetService.loadDataset(path.join(fixturesDir, "sample.csv"));
    investigationService = new InvestigationService();
    evidenceService = new EvidenceService(investigationService);
    findingService = new FindingService(investigationService, evidenceService);
    engine = new NativeAnalysisEngine(datasetService);
    verificationService = new VerificationService(
      investigationService,
      evidenceService,
      findingService,
      engine,
    );
    reportService = new ReportService(
      investigationService,
      evidenceService,
      findingService,
      verificationService,
    );
    markdownRenderer = new MarkdownReportRenderer();
  });

  const toolWithReport = () =>
    defineAgentInvestigationTool({
      datasetService,
      investigationService,
      evidenceService,
      findingService,
      verificationService,
      analysisEngine: engine,
      reportService,
      markdownRenderer,
    });

  const runJakarta = () =>
    toolWithReport().execute(
      {
        path: path.join(fixturesDir, "sample.csv"),
        goal: "Compare Jakarta vs Surabaya revenue",
        max_hypotheses: 1,
      },
      noopExec,
    ) as Promise<any>;

  it("should include a structured report on success", async () => {
    const result = await runJakarta();
    expect(result.status).toBe("completed");
    expect(result.report).toBeDefined();
    expect(result.report.structured.investigation.goal).toBe(
      "Compare Jakarta vs Surabaya revenue",
    );
    expect(result.report.structured.investigation.status).toBe("completed");
  });

  it("should include rendered Markdown on success", async () => {
    const result = await runJakarta();
    expect(typeof result.report.markdown).toBe("string");
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
      expect(result.report.markdown).toContain(section);
    }
  });

  it("should report final hypothesis status, evidence, findings, verification", async () => {
    const result = await runJakarta();
    const structured = result.report.structured;
    expect(structured.hypotheses).toHaveLength(1);
    expect(structured.hypotheses[0].statement).toContain("Jakarta");
    expect(structured.hypotheses[0].statement).toContain("Surabaya");
    expect(structured.hypotheses[0].status).toBe(
      result.hypotheses[0].status,
    );
    expect(structured.evidence).toHaveLength(result.evidenceCount);
    expect(structured.evidence[0].input).toMatchObject({
      baseGroup: "Jakarta",
      compareGroup: "Surabaya",
    });
    expect(structured.findings).toHaveLength(1);
    expect(structured.findings[0].claim).toBe(result.findings[0].claim);
    expect(structured.verification.verified).toBe(1);
    expect(result.findings[0].verificationStatus).toBe("verified");
  });

  it("should surface the factual finding in Markdown", async () => {
    const result = await runJakarta();
    expect(result.report.markdown).toContain(
      "Surabaya revenue was 52.5% higher than Jakarta",
    );
  });

  it("should remain backward compatible without report deps", async () => {
    const legacy = defineAgentInvestigationTool({
      datasetService,
      investigationService,
      evidenceService,
      findingService,
      verificationService,
      analysisEngine: engine,
    });
    const result = (await legacy.execute(
      {
        path: path.join(fixturesDir, "sample.csv"),
        goal: "What is the average revenue by product?",
        max_hypotheses: 1,
      },
      noopExec,
    )) as any;
    expect(result.status).toBe("completed");
    expect(result.report).toBeUndefined();
    expect(result.findings).toHaveLength(1);
  });

  it("should keep error behavior unchanged", async () => {
    const result = (await toolWithReport().execute(
      {
        path: path.join(fixturesDir, "sample.csv"),
        goal: "Analyze revenue",
        max_hypotheses: 0,
      },
      noopExec,
    )) as any;
    expect(result.status).toBe("failed");
    expect(result.report).toBeUndefined();
  });
});
