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
import { FindingNotFoundError } from "../src/utils/errors.js";
import { resetCounters } from "../src/utils/id-generator.js";
import type { Evidence } from "../src/models/evidence.js";
import type { Finding } from "../src/models/finding.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");

/**
 * Verification tests run against the real sample.csv fixture and the
 * real deterministic analysis engine, so re-execution is genuine.
 *
 * Known values for sample.csv (6 rows, revenue column):
 *   sum(revenue) over all rows        = 830001.25
 *   sum(revenue) groupBy region:      Jakarta 295000.5,
 *                                       Bandung 85000,
 *                                       Surabaya 450000.75
 *   compare Jakarta vs Surabaya sum:  base 295000.5, compare 450000.75,
 *                                     absoluteDiff 155000.25
 */
describe("VerificationService", () => {
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

  const createInvestigation = () =>
    investigationService.createInvestigation(
      datasetId,
      "Why did revenue decline in Q3?",
    );

  const makeAggregateRequest = () => ({
    datasetId,
    aggregations: [
      { column: "revenue", func: "sum" as const, alias: "total_revenue" },
    ],
  });

  /** Records evidence whose result matches a real engine run. */
  const createCorrectAggregateEvidence = async (
    investigationId: string,
  ) => {
    const request = makeAggregateRequest();
    const result = await engine.aggregate(request);
    return evidenceService.recordEvidence(
      investigationId,
      "calculation",
      "aggregate",
      request,
      result.result,
    );
  };

  describe("supported findings", () => {
    it("should verify a finding whose evidence reproduces and matches", async () => {
      const inv = createInvestigation();
      const evidence = await createCorrectAggregateEvidence(
        inv.investigationId,
      );
      const finding = findingService.recordFinding(
        inv.investigationId,
        "Total revenue is 830001.25",
        [evidence.id],
      );

      const result = await verificationService.verifyFinding(finding.id);

      expect(result.status).toBe("verified");
      expect(result.findingId).toBe(finding.id);
      expect(result.investigationId).toBe(inv.investigationId);
      expect(result.claim).toBe("Total revenue is 830001.25");
      expect(result.checkedEvidence).toHaveLength(1);

      const check = result.checkedEvidence[0]!;
      expect(check.evidenceId).toBe(evidence.id);
      expect(check.exists).toBe(true);
      expect(check.structurallyValid).toBe(true);
      expect(check.sameInvestigation).toBe(true);
      expect(check.reproducible).toBe(true);
      expect(check.matches).toBe(true);
      expect(check.recordedResult).toEqual([
        { total_revenue: 830001.25 },
      ]);
      expect(check.reproducedResult).toEqual([
        { total_revenue: 830001.25 },
      ]);
      expect(check.reason).toBeUndefined();
      expect(result.reason).toContain("reproduced");

      // The finding itself is updated
      expect(finding.verificationStatus).toBe("verified");
      expect(finding.verificationReason).toBe(result.reason);
    });

    it("should verify trend evidence", async () => {
      const inv = createInvestigation();
      const request = {
        datasetId,
        timeColumn: "date",
        valueColumn: "revenue",
        func: "sum" as const,
      };
      const result = await engine.trend(request);
      const evidence = evidenceService.recordEvidence(
        inv.investigationId,
        "calculation",
        "trend",
        request,
        result.result,
      );
      const finding = findingService.recordFinding(
        inv.investigationId,
        "Revenue trend computed",
        [evidence.id],
      );

      const verification = await verificationService.verifyFinding(
        finding.id,
      );
      expect(verification.status).toBe("verified");
    });

    it("should verify compare evidence", async () => {
      const inv = createInvestigation();
      const request = {
        datasetId,
        groupColumn: "region",
        baseGroup: "Jakarta",
        compareGroup: "Surabaya",
        valueColumn: "revenue",
        func: "sum" as const,
      };
      const result = await engine.compare(request);
      const evidence = evidenceService.recordEvidence(
        inv.investigationId,
        "comparison",
        "compare",
        request,
        result.result,
      );
      const finding = findingService.recordFinding(
        inv.investigationId,
        "Surabaya revenue exceeds Jakarta revenue",
        [evidence.id],
      );

      const verification = await verificationService.verifyFinding(
        finding.id,
      );
      expect(verification.status).toBe("verified");
    });

    it("should accept evidence recorded as the full engine response", async () => {
      const inv = createInvestigation();
      const request = makeAggregateRequest();
      const fullResult = await engine.aggregate(request);
      const evidence = evidenceService.recordEvidence(
        inv.investigationId,
        "calculation",
        "aggregate",
        request,
        fullResult,
      );
      const finding = findingService.recordFinding(
        inv.investigationId,
        "Total revenue is 830001.25",
        [evidence.id],
      );

      const result = await verificationService.verifyFinding(finding.id);
      expect(result.status).toBe("verified");
    });

    it("should verify a finding backed by multiple evidence records", async () => {
      const inv = createInvestigation();

      const aggEvidence = await createCorrectAggregateEvidence(
        inv.investigationId,
      );

      const cmpRequest = {
        datasetId,
        groupColumn: "region",
        baseGroup: "Jakarta",
        compareGroup: "Surabaya",
        valueColumn: "revenue",
        func: "sum" as const,
      };
      const cmpResult = await engine.compare(cmpRequest);
      const cmpEvidence = evidenceService.recordEvidence(
        inv.investigationId,
        "comparison",
        "compare",
        cmpRequest,
        cmpResult.result,
      );

      const finding = findingService.recordFinding(
        inv.investigationId,
        "Surabaya revenue exceeds Jakarta revenue",
        [aggEvidence.id, cmpEvidence.id],
      );

      const result = await verificationService.verifyFinding(finding.id);

      expect(result.status).toBe("verified");
      expect(result.checkedEvidence).toHaveLength(2);
      expect(result.checkedEvidence.every((c) => c.matches === true)).toBe(
        true,
      );
    });
  });

  describe("rejected findings", () => {
    it("should reject a finding whose recorded evidence does not match recomputation", async () => {
      const inv = createInvestigation();
      const request = makeAggregateRequest();
      // Evidence recorded with a FABRICATED result
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

      const result = await verificationService.verifyFinding(finding.id);

      expect(result.status).toBe("rejected");
      const check = result.checkedEvidence[0]!;
      expect(check.matches).toBe(false);
      expect(check.recordedResult).toEqual([{ total_revenue: 999999 }]);
      expect(check.reproducedResult).toEqual([
        { total_revenue: 830001.25 },
      ]);
      expect(check.reason).toContain("does not match");
      expect(result.reason).toContain("does not match");

      expect(finding.verificationStatus).toBe("rejected");
      expect(finding.verificationReason).toBe(result.reason);
    });

    it("should reject a finding when any one of multiple evidence records mismatches", async () => {
      const inv = createInvestigation();

      const correctEvidence = await createCorrectAggregateEvidence(
        inv.investigationId,
      );

      const request = makeAggregateRequest();
      const wrongEvidence = evidenceService.recordEvidence(
        inv.investigationId,
        "calculation",
        "aggregate",
        request,
        [{ total_revenue: 1 }],
      );

      const finding = findingService.recordFinding(
        inv.investigationId,
        "Claim",
        [correctEvidence.id, wrongEvidence.id],
      );

      const result = await verificationService.verifyFinding(finding.id);

      expect(result.status).toBe("rejected");
      expect(result.checkedEvidence[0]!.matches).toBe(true);
      expect(result.checkedEvidence[1]!.matches).toBe(false);
    });

    it("should reject a finding that references missing evidence", async () => {
      const inv = createInvestigation();
      const handBuilt: Finding = {
        id: "finding-001",
        investigationId: inv.investigationId,
        claim: "Claim",
        evidenceIds: ["evidence-999"],
        confidence: 0.5,
        verificationStatus: "unverified",
      };
      const mockFindingService = {
        getFinding: (id: string) => {
          if (id === "finding-001") return handBuilt;
          throw new FindingNotFoundError(id);
        },
      } as unknown as FindingService;

      const service = new VerificationService(
        investigationService,
        evidenceService,
        mockFindingService,
        engine,
      );

      const result = await service.verifyFinding("finding-001");

      expect(result.status).toBe("rejected");
      expect(result.checkedEvidence[0]!.exists).toBe(false);
      expect(result.checkedEvidence[0]!.reproducible).toBe(false);
      expect(result.reason).toContain("does not exist");
    });

    it("should reject a finding whose evidence is structurally invalid", async () => {
      const inv = createInvestigation();
      const invalidEvidence: Evidence = {
        id: "evidence-001",
        investigationId: inv.investigationId,
        type: "calculation",
        operation: "",
        input: {},
        result: {},
        createdAt: new Date().toISOString(),
      };
      const mockEvidenceService = {
        getEvidence: () => invalidEvidence,
      } as unknown as EvidenceService;

      const handBuilt: Finding = {
        id: "finding-001",
        investigationId: inv.investigationId,
        claim: "Claim",
        evidenceIds: ["evidence-001"],
        confidence: 0.5,
        verificationStatus: "unverified",
      };
      const mockFindingService = {
        getFinding: () => handBuilt,
      } as unknown as FindingService;

      const service = new VerificationService(
        investigationService,
        mockEvidenceService,
        mockFindingService,
        engine,
      );

      const result = await service.verifyFinding("finding-001");

      expect(result.status).toBe("rejected");
      expect(result.checkedEvidence[0]!.exists).toBe(true);
      expect(result.checkedEvidence[0]!.structurallyValid).toBe(false);
      expect(result.reason).toContain("structurally invalid");
    });

    it("should reject a finding whose evidence belongs to another investigation", async () => {
      const inv = createInvestigation();
      const foreignEvidence: Evidence = {
        id: "evidence-001",
        investigationId: "investigation-002",
        type: "calculation",
        operation: "aggregate",
        input: {},
        result: {},
        createdAt: new Date().toISOString(),
      };
      const mockEvidenceService = {
        getEvidence: () => foreignEvidence,
      } as unknown as EvidenceService;

      const handBuilt: Finding = {
        id: "finding-001",
        investigationId: inv.investigationId,
        claim: "Claim",
        evidenceIds: ["evidence-001"],
        confidence: 0.5,
        verificationStatus: "unverified",
      };
      const mockFindingService = {
        getFinding: () => handBuilt,
      } as unknown as FindingService;

      const service = new VerificationService(
        investigationService,
        mockEvidenceService,
        mockFindingService,
        engine,
      );

      const result = await service.verifyFinding("finding-001");

      expect(result.status).toBe("rejected");
      expect(result.checkedEvidence[0]!.sameInvestigation).toBe(false);
      expect(result.reason).toContain("different investigation");
    });
  });

  describe("unverified findings (non-reproducible evidence)", () => {
    it("should leave a finding unverified when evidence cannot be re-executed", async () => {
      const inv = createInvestigation();
      const evidence = evidenceService.recordEvidence(
        inv.investigationId,
        "profile",
        "custom_quality_check",
        { threshold: 0.9 },
        { score: 94 },
      );
      const finding = findingService.recordFinding(
        inv.investigationId,
        "Data quality score is 94",
        [evidence.id],
      );

      const result = await verificationService.verifyFinding(finding.id);

      expect(result.status).toBe("unverified");
      const check = result.checkedEvidence[0]!;
      expect(check.exists).toBe(true);
      expect(check.structurallyValid).toBe(true);
      expect(check.sameInvestigation).toBe(true);
      expect(check.reproducible).toBe(false);
      expect(check.matches).toBeUndefined();
      expect(result.reason).toContain("could not be reproduced");
      expect(finding.verificationStatus).toBe("unverified");
    });

    it("should leave a finding unverified when only some evidence is reproducible", async () => {
      const inv = createInvestigation();
      const reproducibleEvidence =
        await createCorrectAggregateEvidence(inv.investigationId);
      const customEvidence = evidenceService.recordEvidence(
        inv.investigationId,
        "profile",
        "custom_op",
        {},
        { note: "manual" },
      );

      const finding = findingService.recordFinding(
        inv.investigationId,
        "Claim",
        [reproducibleEvidence.id, customEvidence.id],
      );

      const result = await verificationService.verifyFinding(finding.id);

      expect(result.status).toBe("unverified");
      expect(result.checkedEvidence[0]!.matches).toBe(true);
      expect(result.checkedEvidence[1]!.reproducible).toBe(false);
    });

    it("should leave a finding unverified when the dataset is no longer available", async () => {
      const inv = createInvestigation();
      const evidence = await createCorrectAggregateEvidence(
        inv.investigationId,
      );
      const finding = findingService.recordFinding(
        inv.investigationId,
        "Total revenue is 830001.25",
        [evidence.id],
      );

      // The engine can no longer re-execute the recorded request
      datasetService.unloadDataset(datasetId);

      const result = await verificationService.verifyFinding(finding.id);

      expect(result.status).toBe("unverified");
      expect(result.checkedEvidence[0]!.reproducible).toBe(false);
    });
  });

  describe("determinism and history", () => {
    it("should produce deterministic results on repeated verification", async () => {
      const inv = createInvestigation();
      const evidence = await createCorrectAggregateEvidence(
        inv.investigationId,
      );
      const finding = findingService.recordFinding(
        inv.investigationId,
        "Total revenue is 830001.25",
        [evidence.id],
      );

      const first = await verificationService.verifyFinding(finding.id);
      const second = await verificationService.verifyFinding(finding.id);

      expect(second.status).toBe(first.status);
      expect(second.reason).toBe(first.reason);
      expect(second.checkedEvidence).toEqual(first.checkedEvidence);
      expect(second.claim).toBe(first.claim);

      expect(verificationService.getVerificationHistory(finding.id)).toHaveLength(2);
      expect(verificationService.getVerificationResult(finding.id)).toBe(
        second,
      );
    });

    it("should return undefined for unverified findings without a verification run", () => {
      expect(
        verificationService.getVerificationResult("finding-001"),
      ).toBeUndefined();
      expect(
        verificationService.getVerificationHistory("finding-001"),
      ).toEqual([]);
    });
  });

  describe("errors", () => {
    it("should throw FindingNotFoundError for unknown findings", async () => {
      await expect(
        verificationService.verifyFinding("finding-999"),
      ).rejects.toThrow(FindingNotFoundError);
    });
  });
});
