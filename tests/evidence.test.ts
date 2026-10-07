import { describe, it, expect, beforeEach } from "vitest";

import { EvidenceService } from "../src/services/evidence-service.js";
import { InvestigationService } from "../src/services/investigation-service.js";
import {
  DataAnalystError,
  EvidenceNotFoundError,
  InvestigationNotFoundError,
  InvestigationStateError,
} from "../src/utils/errors.js";
import { resetCounters } from "../src/utils/id-generator.js";
import type { Evidence } from "../src/models/evidence.js";

describe("EvidenceService", () => {
  let investigationService: InvestigationService;
  let evidenceService: EvidenceService;

  beforeEach(() => {
    resetCounters();
    investigationService = new InvestigationService();
    evidenceService = new EvidenceService(investigationService);
  });

  describe("recordEvidence", () => {
    it("should record evidence and link it to the investigation", () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Why did revenue decline?",
      );

      const evidence = evidenceService.recordEvidence(
        inv.investigationId,
        "comparison",
        "year_over_year_revenue",
        { period: "Q3", groupBy: "region" },
        { Jakarta: -31.2, Bandung: -4.1, Surabaya: 2.8 },
      );

      expect(evidence.id).toBe("evidence-001");
      expect(evidence.investigationId).toBe(inv.investigationId);
      expect(evidence.type).toBe("comparison");
      expect(evidence.operation).toBe("year_over_year_revenue");
      expect(evidence.input).toEqual({
        period: "Q3",
        groupBy: "region",
      });
      expect(evidence.result).toEqual({
        Jakarta: -31.2,
        Bandung: -4.1,
        Surabaya: 2.8,
      });
      expect(evidence.createdAt).toBeDefined();

      // Linked on the investigation
      const stored = investigationService.getInvestigation(
        inv.investigationId,
      );
      expect(stored.evidenceIds).toEqual(["evidence-001"]);
    });

    it("should generate sequential evidence IDs across investigations", () => {
      const inv1 = investigationService.createInvestigation(
        "dataset-001",
        "Goal A",
      );
      const inv2 = investigationService.createInvestigation(
        "dataset-002",
        "Goal B",
      );

      const e1 = evidenceService.recordEvidence(
        inv1.investigationId,
        "profile",
        "dataset_profile",
        {},
        { rows: 6 },
      );
      const e2 = evidenceService.recordEvidence(
        inv2.investigationId,
        "statistic",
        "mean_revenue",
        {},
        166000.25,
      );

      expect(e1.id).toBe("evidence-001");
      expect(e2.id).toBe("evidence-002");
    });

    it("should accept every evidence type from PRD §15", () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Goal",
      );

      const types = [
        "query",
        "calculation",
        "profile",
        "statistic",
        "comparison",
      ] as const;

      for (const type of types) {
        const evidence = evidenceService.recordEvidence(
          inv.investigationId,
          type,
          `op_${type}`,
          null,
          null,
        );
        expect(evidence.type).toBe(type);
      }

      expect(
        investigationService.getInvestigation(inv.investigationId)
          .evidenceIds,
      ).toHaveLength(5);
    });

    it("should reject an unknown evidence type", () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Goal",
      );

      expect(() =>
        evidenceService.recordEvidence(
          inv.investigationId,
          "forecast" as never,
          "op",
          null,
          null,
        ),
      ).toThrow(DataAnalystError);
    });

    it("should reject an empty operation", () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Goal",
      );

      expect(() =>
        evidenceService.recordEvidence(
          inv.investigationId,
          "query",
          "",
          null,
          null,
        ),
      ).toThrow(DataAnalystError);
    });

    it("should throw InvestigationNotFoundError for unknown investigations", () => {
      expect(() =>
        evidenceService.recordEvidence(
          "investigation-999",
          "query",
          "op",
          null,
          null,
        ),
      ).toThrow(InvestigationNotFoundError);
    });

    it("should reject evidence on a completed investigation", () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Goal",
      );
      investigationService.transitionTo(
        inv.investigationId,
        "investigating",
      );
      investigationService.transitionTo(inv.investigationId, "verifying");
      investigationService.transitionTo(inv.investigationId, "completed");

      expect(() =>
        evidenceService.recordEvidence(
          inv.investigationId,
          "query",
          "op",
          null,
          null,
        ),
      ).toThrow(InvestigationStateError);
    });

    it("should reject evidence on a failed investigation", () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Goal",
      );
      investigationService.fail(inv.investigationId, "boom");

      expect(() =>
        evidenceService.recordEvidence(
          inv.investigationId,
          "query",
          "op",
          null,
          null,
        ),
      ).toThrow(InvestigationStateError);
    });
  });

  describe("getEvidence", () => {
    it("should retrieve a stored evidence record", () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Goal",
      );
      const recorded = evidenceService.recordEvidence(
        inv.investigationId,
        "calculation",
        "total_revenue",
        {},
        1000,
      );

      const retrieved = evidenceService.getEvidence(recorded.id);
      expect(retrieved).toBe(recorded);
    });

    it("should throw EvidenceNotFoundError for unknown IDs", () => {
      expect(() =>
        evidenceService.getEvidence("evidence-999"),
      ).toThrow(EvidenceNotFoundError);
    });
  });

  describe("getEvidenceForInvestigation", () => {
    it("should return evidence in recording order", () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Goal",
      );

      evidenceService.recordEvidence(
        inv.investigationId,
        "profile",
        "dataset_profile",
        {},
        { rows: 6 },
      );
      evidenceService.recordEvidence(
        inv.investigationId,
        "calculation",
        "total_revenue",
        {},
        1000,
      );
      evidenceService.recordEvidence(
        inv.investigationId,
        "comparison",
        "region_comparison",
        {},
        { Jakarta: -31.2 },
      );

      const evidence = evidenceService.getEvidenceForInvestigation(
        inv.investigationId,
      );

      expect(evidence).toHaveLength(3);
      expect(evidence.map((e) => e.operation)).toEqual([
        "dataset_profile",
        "total_revenue",
        "region_comparison",
      ]);
    });

    it("should return only this investigation's evidence", () => {
      const inv1 = investigationService.createInvestigation(
        "dataset-001",
        "Goal A",
      );
      const inv2 = investigationService.createInvestigation(
        "dataset-002",
        "Goal B",
      );

      evidenceService.recordEvidence(
        inv1.investigationId,
        "query",
        "op_a",
        null,
        null,
      );
      evidenceService.recordEvidence(
        inv2.investigationId,
        "query",
        "op_b",
        null,
        null,
      );
      evidenceService.recordEvidence(
        inv1.investigationId,
        "query",
        "op_a2",
        null,
        null,
      );

      const evidence1 = evidenceService.getEvidenceForInvestigation(
        inv1.investigationId,
      );
      const evidence2 = evidenceService.getEvidenceForInvestigation(
        inv2.investigationId,
      );

      expect(evidence1.map((e) => e.operation)).toEqual([
        "op_a",
        "op_a2",
      ]);
      expect(evidence2.map((e) => e.operation)).toEqual(["op_b"]);
    });

    it("should return an empty array for an investigation without evidence", () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Goal",
      );

      expect(
        evidenceService.getEvidenceForInvestigation(inv.investigationId),
      ).toEqual([]);
    });

    it("should throw InvestigationNotFoundError for unknown investigations", () => {
      expect(() =>
        evidenceService.getEvidenceForInvestigation("investigation-999"),
      ).toThrow(InvestigationNotFoundError);
    });
  });

  describe("full investigation lifecycle (integration)", () => {
    it("should support the complete M4 flow end-to-end", () => {
      // Create investigation (PRD §13)
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Why did revenue decline in Q3?",
      );
      expect(inv.status).toBe("planning");

      // Propose hypotheses (PRD §14)
      const h1 = investigationService.addHypothesis(
        inv.investigationId,
        "Sales volume decreased.",
      );
      const h2 = investigationService.addHypothesis(
        inv.investigationId,
        "Average order value decreased.",
        "AOV dropped sharply in Q3",
      );

      // Collect evidence (PRD §15) — deterministic computations
      const e1 = evidenceService.recordEvidence(
        inv.investigationId,
        "calculation",
        "order_volume_change",
        { period: "Q3" },
        { changePercent: -3.2 },
      );
      const e2 = evidenceService.recordEvidence(
        inv.investigationId,
        "statistic",
        "aov_change",
        { period: "Q3" },
        { changePercent: -14.8 },
      );

      // Update hypothesis statuses based on evidence
      investigationService.setHypothesisStatus(
        inv.investigationId,
        h1.id,
        "testing",
      );
      investigationService.setHypothesisStatus(
        inv.investigationId,
        h1.id,
        "rejected",
      );
      investigationService.setHypothesisStatus(
        inv.investigationId,
        h2.id,
        "testing",
      );
      investigationService.setHypothesisStatus(
        inv.investigationId,
        h2.id,
        "supported",
      );

      // Progress through the state machine (PRD §19)
      investigationService.transitionTo(
        inv.investigationId,
        "investigating",
      );
      investigationService.transitionTo(inv.investigationId, "verifying");
      investigationService.transitionTo(inv.investigationId, "completed");

      // Verify final state
      const final = investigationService.getInvestigation(
        inv.investigationId,
      );
      expect(final.status).toBe("completed");
      expect(final.completedAt).toBeDefined();
      expect(final.hypotheses).toHaveLength(2);
      expect(final.hypotheses[0]!.status).toBe("rejected");
      expect(final.hypotheses[1]!.status).toBe("supported");
      expect(final.evidenceIds).toEqual([e1.id, e2.id]);

      // Verify evidence is retrievable and consistent
      const evidence = evidenceService.getEvidenceForInvestigation(
        inv.investigationId,
      );
      expect(evidence).toHaveLength(2);
      expect(evidence[0]!.input).toEqual({ period: "Q3" });
      expect(evidence[1]!.result).toEqual({ changePercent: -14.8 });

      // Verify serialization round-trip (AC-08)
      const parsed = JSON.parse(
        investigationService.serialize(inv.investigationId),
      ) as Evidence & { hypotheses: unknown[]; evidenceIds: string[] };
      expect(parsed.evidenceIds).toEqual([e1.id, e2.id]);
      expect(parsed.hypotheses).toHaveLength(2);
    });

    it("should preserve evidence when an investigation fails mid-way", () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Goal",
      );
      investigationService.transitionTo(
        inv.investigationId,
        "investigating",
      );

      evidenceService.recordEvidence(
        inv.investigationId,
        "calculation",
        "partial_result",
        {},
        { value: 42 },
      );

      investigationService.fail(
        inv.investigationId,
        "Engine timeout",
      );

      const failed = investigationService.getInvestigation(
        inv.investigationId,
      );
      expect(failed.status).toBe("failed");
      expect(failed.error).toBe("Engine timeout");
      expect(failed.evidenceIds).toEqual(["evidence-001"]);

      // Evidence remains retrievable after failure
      const evidence = evidenceService.getEvidenceForInvestigation(
        inv.investigationId,
      );
      expect(evidence).toHaveLength(1);
      expect(evidence[0]!.operation).toBe("partial_result");
    });
  });
});
