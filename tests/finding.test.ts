import { describe, it, expect, beforeEach } from "vitest";

import { FindingService } from "../src/services/finding-service.js";
import { InvestigationService } from "../src/services/investigation-service.js";
import { EvidenceService } from "../src/services/evidence-service.js";
import {
  calculateConfidence,
  hypothesisSupportRatio,
} from "../src/utils/confidence.js";
import {
  DataAnalystError,
  EvidenceNotFoundError,
  HypothesisNotFoundError,
  InvestigationNotFoundError,
  InvestigationStateError,
} from "../src/utils/errors.js";
import { resetCounters } from "../src/utils/id-generator.js";
import type { Finding } from "../src/models/finding.js";

describe("FindingService", () => {
  let investigationService: InvestigationService;
  let evidenceService: EvidenceService;
  let findingService: FindingService;

  beforeEach(() => {
    resetCounters();
    investigationService = new InvestigationService();
    evidenceService = new EvidenceService(investigationService);
    findingService = new FindingService(
      investigationService,
      evidenceService,
    );
  });

  /** Investigation in a mutable state with one evidence record. */
  const setup = () => {
    const inv = investigationService.createInvestigation(
      "dataset-001",
      "Why did revenue decline in Q3?",
    );
    const evidence = evidenceService.recordEvidence(
      inv.investigationId,
      "calculation",
      "total_revenue",
      { period: "Q3" },
      830001.25,
    );
    return { inv, evidence };
  };

  describe("recordFinding", () => {
    it("should record a valid finding starting as unverified", () => {
      const { inv, evidence } = setup();

      const finding = findingService.recordFinding(
        inv.investigationId,
        "Total revenue is 830001.25",
        [evidence.id],
      );

      expect(finding.id).toBe("finding-001");
      expect(finding.investigationId).toBe(inv.investigationId);
      expect(finding.claim).toBe("Total revenue is 830001.25");
      expect(finding.evidenceIds).toEqual([evidence.id]);
      expect(finding.hypothesisIds).toBeUndefined();
      expect(finding.verificationStatus).toBe("unverified");
      expect(finding.verificationReason).toBeUndefined();
      expect(finding.confidence).toBeGreaterThanOrEqual(0);
      expect(finding.confidence).toBeLessThanOrEqual(1);
    });

    it("should generate sequential finding IDs", () => {
      const { inv, evidence } = setup();

      const first = findingService.recordFinding(
        inv.investigationId,
        "Claim A",
        [evidence.id],
      );
      const second = findingService.recordFinding(
        inv.investigationId,
        "Claim B",
        [evidence.id],
      );

      expect(first.id).toBe("finding-001");
      expect(second.id).toBe("finding-002");
    });

    it("should trim the claim", () => {
      const { inv, evidence } = setup();
      const finding = findingService.recordFinding(
        inv.investigationId,
        "  Claim  ",
        [evidence.id],
      );
      expect(finding.claim).toBe("Claim");
    });

    it("should reject an empty claim", () => {
      const { inv, evidence } = setup();
      expect(() =>
        findingService.recordFinding(inv.investigationId, "", [evidence.id]),
      ).toThrow(DataAnalystError);
      expect(() =>
        findingService.recordFinding(
          inv.investigationId,
          "   ",
          [evidence.id],
        ),
      ).toThrow(DataAnalystError);
    });

    it("should reject a finding with no evidence (AC-04)", () => {
      const { inv } = setup();

      let caught: unknown;
      try {
        findingService.recordFinding(inv.investigationId, "Claim", []);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(DataAnalystError);
      expect((caught as DataAnalystError).code).toBe(
        "FINDING_REQUIRES_EVIDENCE",
      );
    });

    it("should reject a non-existent evidence ID", () => {
      const { inv } = setup();
      expect(() =>
        findingService.recordFinding(
          inv.investigationId,
          "Claim",
          ["evidence-999"],
        ),
      ).toThrow(EvidenceNotFoundError);
    });

    it("should reject evidence from another investigation", () => {
      const inv1 = investigationService.createInvestigation(
        "dataset-001",
        "Goal A",
      );
      const inv2 = investigationService.createInvestigation(
        "dataset-002",
        "Goal B",
      );
      const evidence2 = evidenceService.recordEvidence(
        inv2.investigationId,
        "calculation",
        "op",
        {},
        42,
      );

      let caught: unknown;
      try {
        findingService.recordFinding(
          inv1.investigationId,
          "Claim",
          [evidence2.id],
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(DataAnalystError);
      expect((caught as DataAnalystError).code).toBe(
        "CROSS_INVESTIGATION_EVIDENCE",
      );
    });

    it("should reject a non-existent hypothesis ID", () => {
      const { inv, evidence } = setup();
      expect(() =>
        findingService.recordFinding(
          inv.investigationId,
          "Claim",
          [evidence.id],
          { hypothesisIds: ["H99"] },
        ),
      ).toThrow(HypothesisNotFoundError);
    });

    it("should reject a hypothesis from another investigation", () => {
      const inv1 = investigationService.createInvestigation(
        "dataset-001",
        "Goal A",
      );
      const inv2 = investigationService.createInvestigation(
        "dataset-002",
        "Goal B",
      );
      const evidence1 = evidenceService.recordEvidence(
        inv1.investigationId,
        "calculation",
        "op",
        {},
        42,
      );
      // H1 exists — but in investigation-002, not investigation-001
      investigationService.addHypothesis(
        inv2.investigationId,
        "Hypothesis in investigation 2",
      );

      expect(() =>
        findingService.recordFinding(
          inv1.investigationId,
          "Claim",
          [evidence1.id],
          { hypothesisIds: ["H1"] },
        ),
      ).toThrow(HypothesisNotFoundError);
    });

    it("should store hypothesis IDs when provided", () => {
      const { inv, evidence } = setup();
      const h1 = investigationService.addHypothesis(
        inv.investigationId,
        "Sales volume decreased.",
      );
      const h2 = investigationService.addHypothesis(
        inv.investigationId,
        "Average order value decreased.",
      );

      const finding = findingService.recordFinding(
        inv.investigationId,
        "Revenue declined due to volume and AOV",
        [evidence.id],
        { hypothesisIds: [h1.id, h2.id] },
      );

      expect(finding.hypothesisIds).toEqual(["H1", "H2"]);
    });

    it("should calculate confidence deterministically when omitted", () => {
      const { inv, evidence } = setup();

      // 1 evidence record, no linked hypotheses:
      // 0.5 * (1/3) + 0.5 * 0.5 = 0.4166... → 0.42
      const finding = findingService.recordFinding(
        inv.investigationId,
        "Claim",
        [evidence.id],
      );

      expect(finding.confidence).toBe(0.42);
    });

    it("should calculate higher confidence with more evidence and supported hypotheses", () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Goal",
      );

      const evidenceIds = [1, 2, 3].map(() =>
        evidenceService.recordEvidence(
          inv.investigationId,
          "calculation",
          "op",
          {},
          42,
        ).id,
      );

      const h1 = investigationService.addHypothesis(
        inv.investigationId,
        "H1",
      );
      const h2 = investigationService.addHypothesis(
        inv.investigationId,
        "H2",
      );
      investigationService.setHypothesisStatus(
        inv.investigationId,
        h1.id,
        "supported",
      );
      investigationService.setHypothesisStatus(
        inv.investigationId,
        h2.id,
        "supported",
      );

      const finding = findingService.recordFinding(
        inv.investigationId,
        "Claim",
        evidenceIds,
        { hypothesisIds: [h1.id, h2.id] },
      );

      // 0.5 * min(3/3, 1) + 0.5 * (2/2) = 1.0
      expect(finding.confidence).toBe(1);
    });

    it("should accept explicit confidence within [0, 1]", () => {
      const { inv, evidence } = setup();

      for (const confidence of [0, 0.5, 1]) {
        const finding = findingService.recordFinding(
          inv.investigationId,
          "Claim",
          [evidence.id],
          { confidence },
        );
        expect(finding.confidence).toBe(confidence);
      }
    });

    it("should reject confidence outside [0, 1]", () => {
      const { inv, evidence } = setup();

      for (const confidence of [1.5, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() =>
          findingService.recordFinding(
            inv.investigationId,
            "Claim",
            [evidence.id],
            { confidence },
          ),
        ).toThrow(DataAnalystError);
      }
    });

    it("should reject findings for unknown investigations", () => {
      expect(() =>
        findingService.recordFinding(
          "investigation-999",
          "Claim",
          ["evidence-001"],
        ),
      ).toThrow(InvestigationNotFoundError);
    });

    it("should reject findings on completed investigations", () => {
      const { inv, evidence } = setup();
      investigationService.transitionTo(
        inv.investigationId,
        "investigating",
      );
      investigationService.transitionTo(inv.investigationId, "verifying");
      investigationService.transitionTo(inv.investigationId, "completed");

      expect(() =>
        findingService.recordFinding(
          inv.investigationId,
          "Claim",
          [evidence.id],
        ),
      ).toThrow(InvestigationStateError);
    });
  });

  describe("retrieval", () => {
    it("should retrieve a finding by ID", () => {
      const { inv, evidence } = setup();
      const created = findingService.recordFinding(
        inv.investigationId,
        "Claim",
        [evidence.id],
      );

      const retrieved = findingService.getFinding(created.id);
      expect(retrieved).toBe(created);
    });

    it("should throw FindingNotFoundError for unknown IDs", () => {
      expect(() => findingService.getFinding("finding-999")).toThrow(
        "Finding not found: finding-999",
      );
    });

    it("should list findings for an investigation", () => {
      const inv1 = investigationService.createInvestigation(
        "dataset-001",
        "Goal A",
      );
      const inv2 = investigationService.createInvestigation(
        "dataset-002",
        "Goal B",
      );
      const evidence1 = evidenceService.recordEvidence(
        inv1.investigationId,
        "calculation",
        "op",
        {},
        1,
      );
      const evidence2 = evidenceService.recordEvidence(
        inv2.investigationId,
        "calculation",
        "op",
        {},
        2,
      );

      findingService.recordFinding(
        inv1.investigationId,
        "Claim A1",
        [evidence1.id],
      );
      findingService.recordFinding(
        inv1.investigationId,
        "Claim A2",
        [evidence1.id],
      );
      findingService.recordFinding(
        inv2.investigationId,
        "Claim B1",
        [evidence2.id],
      );

      const findings1 = findingService.getFindingsForInvestigation(
        inv1.investigationId,
      );
      const findings2 = findingService.getFindingsForInvestigation(
        inv2.investigationId,
      );

      expect(findings1).toHaveLength(2);
      expect(findings1.map((f) => f.claim)).toEqual([
        "Claim A1",
        "Claim A2",
      ]);
      expect(findings2).toHaveLength(1);
    });

    it("should throw InvestigationNotFoundError when listing for unknown investigations", () => {
      expect(() =>
        findingService.getFindingsForInvestigation("investigation-999"),
      ).toThrow(InvestigationNotFoundError);
    });
  });

  describe("finding model shape (PRD §16)", () => {
    it("should produce a JSON-serializable finding (AC-08)", () => {
      const { inv, evidence } = setup();
      const h1 = investigationService.addHypothesis(
        inv.investigationId,
        "H1",
      );

      const finding = findingService.recordFinding(
        inv.investigationId,
        "Claim",
        [evidence.id],
        { hypothesisIds: [h1.id], confidence: 0.75 },
      );

      const parsed = JSON.parse(JSON.stringify(finding)) as Finding;
      expect(parsed.id).toBe("finding-001");
      expect(parsed.claim).toBe("Claim");
      expect(parsed.evidenceIds).toEqual([evidence.id]);
      expect(parsed.hypothesisIds).toEqual(["H1"]);
      expect(parsed.confidence).toBe(0.75);
      expect(parsed.verificationStatus).toBe("unverified");
    });
  });
});

describe("confidence calculation (PRD §21, §28)", () => {
  it("should scale with evidence availability", () => {
    expect(calculateConfidence(1, null)).toBe(0.42);
    expect(calculateConfidence(2, null)).toBe(0.58);
    expect(calculateConfidence(3, null)).toBe(0.75);
    expect(calculateConfidence(10, null)).toBe(0.75); // saturates at 3
  });

  it("should scale with hypothesis support", () => {
    expect(calculateConfidence(3, 0)).toBe(0.5);
    expect(calculateConfidence(3, 0.5)).toBe(0.75);
    expect(calculateConfidence(3, 1)).toBe(1);
  });

  it("should treat no linked hypotheses as neutral", () => {
    expect(hypothesisSupportRatio([])).toBeNull();
    expect(hypothesisSupportRatio(["supported", "rejected"])).toBe(0.5);
    expect(
      hypothesisSupportRatio(["supported", "supported", "rejected"]),
    ).toBeCloseTo(2 / 3);
  });
});
