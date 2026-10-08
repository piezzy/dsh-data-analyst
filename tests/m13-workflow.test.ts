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
import { NativeAnalysisEngine } from "../src/engines/native-engine.js";
import { defineStartInvestigationTool } from "../src/tools/start-investigation.js";
import { defineAddHypothesisTool } from "../src/tools/add-hypothesis.js";
import { defineTransitionInvestigationTool } from "../src/tools/transition-investigation.js";
import { defineRecordEvidenceTool } from "../src/tools/record-evidence.js";
import { defineGetInvestigationTool } from "../src/tools/get-investigation.js";
import { defineRecordFindingTool } from "../src/tools/record-finding.js";
import { defineVerifyFindingTool } from "../src/tools/verify-finding.js";
import { defineGetFindingTool } from "../src/tools/get-finding.js";
import { defineAgentInvestigationTool } from "../src/tools/agent-investigation.js";
import { EVIDENCE_TYPES } from "../src/models/evidence.js";
import { resetCounters } from "../src/utils/id-generator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.join(__dirname, "fixtures", "sample.csv");

const noopExec = {} as any;

/**
 * M13.4 — DSH workflow completeness through discrete public tools:
 * hypothesize and transition are first-class tools, evidence kinds
 * name the reproducible operations, and the full stepwise workflow
 * (without run_investigation) reaches a verified finding.
 */
describe("M13.4 discrete workflow tools", () => {
  let datasetService: DatasetService;
  let investigationService: InvestigationService;
  let evidenceService: EvidenceService;
  let findingService: FindingService;
  let verificationService: VerificationService;
  let engine: NativeAnalysisEngine;

  beforeEach(() => {
    resetCounters();
    const registry = new LoaderRegistry();
    registry.register(new CsvLoader());
    datasetService = new DatasetService(registry);
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
  });

  describe("add_hypothesis", () => {
    it("records H1 as proposed with rationale", async () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Why?",
      );
      const tool = defineAddHypothesisTool({ investigationService });
      const h = (await tool.execute(
        {
          investigation_id: inv.investigationId,
          statement: "North beats South.",
          rationale: "Regional split observed.",
        },
        noopExec,
      )) as any;
      expect(h.id).toBe("H1");
      expect(h.status).toBe("proposed");
      expect(h.statement).toBe("North beats South.");
      expect(h.rationale).toBe("Regional split observed.");
    });

    it("assigns sequential IDs and allows missing rationale", async () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Why?",
      );
      const tool = defineAddHypothesisTool({ investigationService });
      await tool.execute(
        { investigation_id: inv.investigationId, statement: "First." },
        noopExec,
      );
      const h2 = (await tool.execute(
        { investigation_id: inv.investigationId, statement: "Second." },
        noopExec,
      )) as any;
      expect(h2.id).toBe("H2");
      expect(h2.rationale).toBeUndefined();
    });

    it("rejects empty statements, unknown and terminal investigations", async () => {
      const tool = defineAddHypothesisTool({ investigationService });
      await expect(
        tool.execute(
          { investigation_id: "investigation-999", statement: "X." },
          noopExec,
        ),
      ).rejects.toThrow();
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Why?",
      );
      await expect(
        tool.execute(
          { investigation_id: inv.investigationId, statement: "   " },
          noopExec,
        ),
      ).rejects.toThrow();
      investigationService.transitionTo(inv.investigationId, "investigating");
      investigationService.transitionTo(inv.investigationId, "verifying");
      investigationService.transitionTo(inv.investigationId, "completed");
      await expect(
        tool.execute(
          { investigation_id: inv.investigationId, statement: "Late." },
          noopExec,
        ),
      ).rejects.toThrow();
    });
  });

  describe("transition_investigation", () => {
    it("drives the required state chain", async () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Why?",
      );
      const tool = defineTransitionInvestigationTool({ investigationService });
      for (const status of ["investigating", "verifying", "completed"] as const) {
        const updated = (await tool.execute(
          { investigation_id: inv.investigationId, status },
          noopExec,
        )) as any;
        expect(updated.status).toBe(status);
      }
    });

    it("rejects skipped states and unknown investigations", async () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Why?",
      );
      const tool = defineTransitionInvestigationTool({ investigationService });
      await expect(
        tool.execute(
          { investigation_id: inv.investigationId, status: "completed" },
          noopExec,
        ),
      ).rejects.toThrow();
      await expect(
        tool.execute(
          { investigation_id: "investigation-999", status: "investigating" },
          noopExec,
        ),
      ).rejects.toThrow();
    });

    it("records failure reasons when failing", async () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Why?",
      );
      const tool = defineTransitionInvestigationTool({ investigationService });
      const failed = (await tool.execute(
        {
          investigation_id: inv.investigationId,
          status: "failed",
          reason: "Ran out of budget.",
        },
        noopExec,
      )) as any;
      expect(failed.status).toBe("failed");
      expect(failed.error).toBe("Ran out of budget.");
    });
  });

  describe("evidence kinds align with reproducible operations", () => {
    it("declares aggregate and trend kinds", () => {
      expect(EVIDENCE_TYPES).toContain("aggregate");
      expect(EVIDENCE_TYPES).toContain("trend");
      expect(EVIDENCE_TYPES).toContain("comparison");
    });

    it("record_evidence accepts the operation kinds", async () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Why?",
      );
      const tool = defineRecordEvidenceTool({
        investigationService,
        evidenceService,
      });
      for (const type of ["aggregate", "trend", "comparison"] as const) {
        const ev = (await tool.execute(
          {
            investigation_id: inv.investigationId,
            type,
            operation: type === "comparison" ? "compare" : type,
            input: {},
            result: {},
          },
          noopExec,
        )) as any;
        expect(ev.type).toBe(type);
      }
    });

    it("agent runs record operation-named kinds", async () => {
      const tool = defineAgentInvestigationTool({
        datasetService,
        investigationService,
        evidenceService,
        findingService,
        verificationService,
        analysisEngine: engine,
      });
      const aggregate = (await tool.execute(
        {
          path: FIXTURE,
          goal: "What is the average revenue by product?",
          max_hypotheses: 1,
        },
        noopExec,
      )) as any;
      const stored = evidenceService.getEvidenceForInvestigation(
        aggregate.investigationId,
      );
      expect(stored.length).toBeGreaterThan(0);
      expect(stored[0]?.operation).toBe("aggregate");
      expect(stored[0]?.type).toBe("aggregate");

      const trend = (await tool.execute(
        {
          path: FIXTURE,
          goal: "Show the revenue trend over time",
          max_hypotheses: 1,
        },
        noopExec,
      )) as any;
      const trendStored = evidenceService.getEvidenceForInvestigation(
        trend.investigationId,
      );
      expect(trendStored[0]?.operation).toBe("trend");
      expect(trendStored[0]?.type).toBe("trend");
    });
  });

  describe("stepwise workflow without run_investigation", () => {
    it("reaches a verified finding through discrete tools only", async () => {
      const dataset = await datasetService.loadDataset(FIXTURE);
      const datasetId = dataset.metadata.datasetId;

      const start = defineStartInvestigationTool({
        datasetService,
        investigationService,
      });
      const inv = (await start.execute(
        { dataset_id: datasetId, goal: "Compare revenue across regions" },
        noopExec,
      )) as any;
      expect(inv.status).toBe("planning");

      const transition = defineTransitionInvestigationTool({
        investigationService,
      });
      await transition.execute(
        { investigation_id: inv.investigationId, status: "investigating" },
        noopExec,
      );

      const hypothesize = defineAddHypothesisTool({ investigationService });
      const h = (await hypothesize.execute(
        {
          investigation_id: inv.investigationId,
          statement: "Mean revenue differs across region.",
        },
        noopExec,
      )) as any;
      expect(h.id).toBe("H1");

      const computed = await engine.aggregate({
        datasetId,
        aggregations: [{ column: "revenue", func: "mean", alias: "mean" }],
        groupBy: "region",
      });
      const record = defineRecordEvidenceTool({
        investigationService,
        evidenceService,
      });
      const ev = (await record.execute(
        {
          investigation_id: inv.investigationId,
          type: "aggregate",
          operation: "aggregate",
          input: {
            datasetId,
            aggregations: [{ column: "revenue", func: "mean", alias: "mean" }],
            groupBy: "region",
          },
          result: computed.result,
        },
        noopExec,
      )) as any;
      expect(ev.type).toBe("aggregate");

      const find = defineRecordFindingTool({ findingService });
      const finding = (await find.execute(
        {
          investigation_id: inv.investigationId,
          claim: "Mean revenue differs across region.",
          evidence_ids: [ev.id],
          hypothesis_ids: [h.id],
        },
        noopExec,
      )) as any;
      expect(finding.verificationStatus).toBe("unverified");

      await transition.execute(
        { investigation_id: inv.investigationId, status: "verifying" },
        noopExec,
      );
      const verify = defineVerifyFindingTool({ verificationService });
      const verification = (await verify.execute(
        { finding_id: finding.id },
        noopExec,
      )) as any;
      expect(verification.status).toBe("verified");

      await transition.execute(
        { investigation_id: inv.investigationId, status: "completed" },
        noopExec,
      );

      const getInv = defineGetInvestigationTool({
        investigationService,
        evidenceService,
      });
      const readBack = (await getInv.execute(
        { investigation_id: inv.investigationId, include_evidence: true },
        noopExec,
      )) as any;
      expect(readBack.status).toBe("completed");
      expect(readBack.hypotheses).toHaveLength(1);
      expect(readBack.evidence).toHaveLength(1);

      const getFinding = defineGetFindingTool({
        findingService,
        verificationService,
      });
      const readFinding = (await getFinding.execute(
        { finding_id: finding.id, include_verification: true },
        noopExec,
      )) as any;
      expect(readFinding.verificationStatus).toBe("verified");
    });
  });
});
