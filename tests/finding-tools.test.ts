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
import { defineRecordFindingTool } from "../src/tools/record-finding.js";
import { defineVerifyFindingTool } from "../src/tools/verify-finding.js";
import { defineGetFindingTool } from "../src/tools/get-finding.js";
import { FindingNotFoundError } from "../src/utils/errors.js";
import { resetCounters } from "../src/utils/id-generator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");

/** Minimal stand-in for the Cordis ToolRunContext (tools here ignore it). */
const noopExec = {} as any;

describe("M5 finding tools", () => {
  let datasetService: DatasetService;
  let investigationService: InvestigationService;
  let evidenceService: EvidenceService;
  let findingService: FindingService;
  let verificationService: VerificationService;
  let engine: NativeAnalysisEngine;
  let datasetId: string;

  beforeEach(async () => {
    resetCounters();
    const registry = new LoaderRegistry();
    registry.register(new CsvLoader());
    datasetService = new DatasetService(registry);
    const dataset = await datasetService.loadDataset(
      path.join(fixturesDir, "sample.csv"),
    );
    datasetId = dataset.metadata.datasetId;

    investigationService = new InvestigationService();
    evidenceService = new EvidenceService(investigationService);
    findingService = new FindingService(
      investigationService,
      evidenceService,
    );
    engine = new NativeAnalysisEngine(datasetService);
    verificationService = new VerificationService(
      investigationService,
      evidenceService,
      findingService,
      engine,
    );
  });

  /** Records evidence whose result matches a real engine run. */
  const createCorrectAggregateEvidence = async (
    investigationId: string,
  ) => {
    const request = {
      datasetId,
      aggregations: [
        {
          column: "revenue",
          func: "sum" as const,
          alias: "total_revenue",
        },
      ],
    };
    const result = await engine.aggregate(request);
    return evidenceService.recordEvidence(
      investigationId,
      "calculation",
      "aggregate",
      request,
      result.result,
    );
  };

  describe("record_finding", () => {
    it("should record a finding for an investigation", async () => {
      const inv = investigationService.createInvestigation(
        datasetId,
        "Why did revenue decline?",
      );
      const evidence = await createCorrectAggregateEvidence(
        inv.investigationId,
      );
      const tool = defineRecordFindingTool({ findingService });

      const result = (await tool.execute(
        {
          investigation_id: inv.investigationId,
          claim: "Total revenue is 830001.25",
          evidence_ids: [evidence.id],
        },
        noopExec,
      )) as any;

      expect(result.id).toBe("finding-001");
      expect(result.investigationId).toBe(inv.investigationId);
      expect(result.claim).toBe("Total revenue is 830001.25");
      expect(result.evidenceIds).toEqual([evidence.id]);
      expect(result.verificationStatus).toBe("unverified");
      expect(result.confidence).toBe(0.42);
    });

    it("should reject empty evidence_ids (AC-04)", async () => {
      const inv = investigationService.createInvestigation(
        datasetId,
        "Why?",
      );
      const tool = defineRecordFindingTool({ findingService });

      await expect(
        tool.execute(
          {
            investigation_id: inv.investigationId,
            claim: "Claim",
            evidence_ids: [],
          },
          noopExec,
        ),
      ).rejects.toThrow();
    });

    it("should reject out-of-range confidence", async () => {
      const inv = investigationService.createInvestigation(
        datasetId,
        "Why?",
      );
      const evidence = await createCorrectAggregateEvidence(
        inv.investigationId,
      );
      const tool = defineRecordFindingTool({ findingService });

      await expect(
        tool.execute(
          {
            investigation_id: inv.investigationId,
            claim: "Claim",
            evidence_ids: [evidence.id],
            confidence: 1.5,
          },
          noopExec,
        ),
      ).rejects.toThrow();
    });

    it("should store hypothesis references", async () => {
      const inv = investigationService.createInvestigation(
        datasetId,
        "Why?",
      );
      const h1 = investigationService.addHypothesis(
        inv.investigationId,
        "Sales volume decreased.",
      );
      const evidence = await createCorrectAggregateEvidence(
        inv.investigationId,
      );
      const tool = defineRecordFindingTool({ findingService });

      const result = (await tool.execute(
        {
          investigation_id: inv.investigationId,
          claim: "Revenue declined due to lower volume",
          evidence_ids: [evidence.id],
          hypothesis_ids: [h1.id],
        },
        noopExec,
      )) as any;

      expect(result.hypothesisIds).toEqual(["H1"]);
    });

    it("should reject evidence from another investigation", async () => {
      const inv1 = investigationService.createInvestigation(
        datasetId,
        "Goal A",
      );
      const inv2 = investigationService.createInvestigation(
        datasetId,
        "Goal B",
      );
      const evidence2 = await createCorrectAggregateEvidence(
        inv2.investigationId,
      );
      const tool = defineRecordFindingTool({ findingService });

      await expect(
        tool.execute(
          {
            investigation_id: inv1.investigationId,
            claim: "Claim",
            evidence_ids: [evidence2.id],
          },
          noopExec,
        ),
      ).rejects.toThrow();
    });
  });

  describe("verify_finding", () => {
    it("should verify a recorded finding deterministically", async () => {
      const inv = investigationService.createInvestigation(
        datasetId,
        "Why?",
      );
      const evidence = await createCorrectAggregateEvidence(
        inv.investigationId,
      );
      const finding = findingService.recordFinding(
        inv.investigationId,
        "Total revenue is 830001.25",
        [evidence.id],
      );
      const tool = defineVerifyFindingTool({ verificationService });

      const result = (await tool.execute(
        { finding_id: finding.id },
        noopExec,
      )) as any;

      expect(result.findingId).toBe(finding.id);
      expect(result.status).toBe("verified");
      expect(result.checkedEvidence).toHaveLength(1);
      expect(result.checkedEvidence[0].matches).toBe(true);
      expect(result.checkedEvidence[0].reproducedResult).toEqual([
        { total_revenue: 830001.25 },
      ]);
    });

    it("should reject a finding with contradicted evidence", async () => {
      const inv = investigationService.createInvestigation(
        datasetId,
        "Why?",
      );
      const request = {
        datasetId,
        aggregations: [
          {
            column: "revenue",
            func: "sum" as const,
            alias: "total_revenue",
          },
        ],
      };
      const evidence = evidenceService.recordEvidence(
        inv.investigationId,
        "calculation",
        "aggregate",
        request,
        [{ total_revenue: 999999 }],
      );
      const finding = findingService.recordFinding(
        inv.investigationId,
        "Total revenue is 999999",
        [evidence.id],
      );
      const tool = defineVerifyFindingTool({ verificationService });

      const result = (await tool.execute(
        { finding_id: finding.id },
        noopExec,
      )) as any;

      expect(result.status).toBe("rejected");
      expect(result.checkedEvidence[0].matches).toBe(false);
    });

    it("should reject unknown finding IDs", async () => {
      const tool = defineVerifyFindingTool({ verificationService });

      await expect(
        tool.execute({ finding_id: "finding-999" }, noopExec),
      ).rejects.toThrow(FindingNotFoundError);
    });
  });

  describe("get_finding", () => {
    it("should retrieve a finding without verification by default", async () => {
      const inv = investigationService.createInvestigation(
        datasetId,
        "Why?",
      );
      const evidence = await createCorrectAggregateEvidence(
        inv.investigationId,
      );
      const finding = findingService.recordFinding(
        inv.investigationId,
        "Total revenue is 830001.25",
        [evidence.id],
      );
      const tool = defineGetFindingTool({
        findingService,
        verificationService,
      });

      const result = (await tool.execute(
        { finding_id: finding.id },
        noopExec,
      )) as any;

      expect(result.id).toBe(finding.id);
      expect(result.claim).toBe("Total revenue is 830001.25");
      expect(result.verificationStatus).toBe("unverified");
      expect(result.verification).toBeUndefined();
    });

    it("should attach the verification result when requested", async () => {
      const inv = investigationService.createInvestigation(
        datasetId,
        "Why?",
      );
      const evidence = await createCorrectAggregateEvidence(
        inv.investigationId,
      );
      const finding = findingService.recordFinding(
        inv.investigationId,
        "Total revenue is 830001.25",
        [evidence.id],
      );
      await verificationService.verifyFinding(finding.id);

      const tool = defineGetFindingTool({
        findingService,
        verificationService,
      });

      const result = (await tool.execute(
        { finding_id: finding.id, include_verification: true },
        noopExec,
      )) as any;

      expect(result.verificationStatus).toBe("verified");
      expect(result.verification.status).toBe("verified");
      expect(result.verification.checkedEvidence[0].matches).toBe(true);
    });

    it("should reject unknown finding IDs", async () => {
      const tool = defineGetFindingTool({
        findingService,
        verificationService,
      });

      await expect(
        tool.execute({ finding_id: "finding-999" }, noopExec),
      ).rejects.toThrow(FindingNotFoundError);
    });
  });
});
