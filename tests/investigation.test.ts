import { describe, it, expect, beforeEach } from "vitest";

import { InvestigationService } from "../src/services/investigation-service.js";
import {
  DataAnalystError,
  HypothesisNotFoundError,
  InvestigationNotFoundError,
  InvestigationStateError,
} from "../src/utils/errors.js";
import { resetCounters } from "../src/utils/id-generator.js";
import type { Investigation } from "../src/models/investigation.js";

describe("InvestigationService", () => {
  let service: InvestigationService;

  beforeEach(() => {
    resetCounters();
    service = new InvestigationService();
  });

  describe("createInvestigation", () => {
    it("should create an investigation in planning status", () => {
      const investigation = service.createInvestigation(
        "dataset-001",
        "Why did revenue decline in Q3?",
      );

      expect(investigation.investigationId).toBe("investigation-001");
      expect(investigation.datasetId).toBe("dataset-001");
      expect(investigation.goal).toBe("Why did revenue decline in Q3?");
      expect(investigation.status).toBe("planning");
      expect(investigation.hypotheses).toEqual([]);
      expect(investigation.evidenceIds).toEqual([]);
      expect(investigation.createdAt).toBeDefined();
      expect(investigation.updatedAt).toBeDefined();
      expect(investigation.completedAt).toBeUndefined();
      expect(investigation.error).toBeUndefined();
    });

    it("should generate sequential investigation IDs", () => {
      const first = service.createInvestigation("dataset-001", "Goal A");
      const second = service.createInvestigation("dataset-001", "Goal B");

      expect(first.investigationId).toBe("investigation-001");
      expect(second.investigationId).toBe("investigation-002");
    });

    it("should trim the goal", () => {
      const investigation = service.createInvestigation(
        "dataset-001",
        "  Why?  ",
      );
      expect(investigation.goal).toBe("Why?");
    });

    it("should reject an empty goal", () => {
      expect(() => service.createInvestigation("dataset-001", "")).toThrow(
        DataAnalystError,
      );
      expect(() => service.createInvestigation("dataset-001", "   ")).toThrow(
        DataAnalystError,
      );
    });
  });

  describe("getInvestigation", () => {
    it("should retrieve a stored investigation", () => {
      const created = service.createInvestigation("dataset-001", "Goal");
      const retrieved = service.getInvestigation(created.investigationId);
      expect(retrieved).toBe(created);
    });

    it("should throw InvestigationNotFoundError for unknown IDs", () => {
      expect(() => service.getInvestigation("investigation-999")).toThrow(
        InvestigationNotFoundError,
      );
    });
  });

  describe("listInvestigations", () => {
    it("should return all investigations in creation order", () => {
      service.createInvestigation("dataset-001", "Goal A");
      service.createInvestigation("dataset-002", "Goal B");

      const list = service.listInvestigations();
      expect(list).toHaveLength(2);
      expect(list[0]!.goal).toBe("Goal A");
      expect(list[1]!.goal).toBe("Goal B");
    });

    it("should return an empty array when none exist", () => {
      expect(service.listInvestigations()).toEqual([]);
    });
  });

  describe("addHypothesis", () => {
    it("should add hypotheses with sequential H1, H2 IDs in proposed status", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");

      const h1 = service.addHypothesis(
        inv.investigationId,
        "Sales volume decreased.",
      );
      const h2 = service.addHypothesis(
        inv.investigationId,
        "Average order value decreased.",
      );

      expect(h1.id).toBe("H1");
      expect(h1.investigationId).toBe(inv.investigationId);
      expect(h1.statement).toBe("Sales volume decreased.");
      expect(h1.status).toBe("proposed");
      expect(h1.rationale).toBeUndefined();

      expect(h2.id).toBe("H2");
      expect(h2.status).toBe("proposed");

      const stored = service.getInvestigation(inv.investigationId);
      expect(stored.hypotheses).toHaveLength(2);
      expect(stored.hypotheses.map((h) => h.id)).toEqual(["H1", "H2"]);
    });

    it("should store an optional rationale", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      const h1 = service.addHypothesis(
        inv.investigationId,
        "Revenue decline is regional.",
        "Jakarta shows the steepest drop",
      );

      expect(h1.rationale).toBe("Jakarta shows the steepest drop");
    });

    it("should trim statement and rationale", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      const h1 = service.addHypothesis(
        inv.investigationId,
        "  Statement  ",
        "  Rationale  ",
      );

      expect(h1.statement).toBe("Statement");
      expect(h1.rationale).toBe("Rationale");
    });

    it("should reject an empty statement", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      expect(() =>
        service.addHypothesis(inv.investigationId, ""),
      ).toThrow(DataAnalystError);
      expect(() =>
        service.addHypothesis(inv.investigationId, "   "),
      ).toThrow(DataAnalystError);
    });

    it("should reject hypotheses on a completed investigation", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      service.transitionTo(inv.investigationId, "investigating");
      service.transitionTo(inv.investigationId, "verifying");
      service.transitionTo(inv.investigationId, "completed");

      expect(() =>
        service.addHypothesis(inv.investigationId, "Too late"),
      ).toThrow(InvestigationStateError);
    });

    it("should reject hypotheses on a failed investigation", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      service.fail(inv.investigationId, "boom");

      expect(() =>
        service.addHypothesis(inv.investigationId, "Too late"),
      ).toThrow(InvestigationStateError);
    });
  });

  describe("setHypothesisStatus", () => {
    it("should update a hypothesis status", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      const h1 = service.addHypothesis(inv.investigationId, "Statement");

      const updated = service.setHypothesisStatus(
        inv.investigationId,
        h1.id,
        "testing",
      );
      expect(updated.status).toBe("testing");

      service.setHypothesisStatus(inv.investigationId, h1.id, "supported");
      expect(
        service.getInvestigation(inv.investigationId).hypotheses[0]!.status,
      ).toBe("supported");
    });

    it("should throw HypothesisNotFoundError for a foreign hypothesis ID", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      expect(() =>
        service.setHypothesisStatus(inv.investigationId, "H99", "testing"),
      ).toThrow(HypothesisNotFoundError);
    });

    it("should reject status changes on a terminal investigation", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      const h1 = service.addHypothesis(inv.investigationId, "Statement");
      service.transitionTo(inv.investigationId, "investigating");
      service.transitionTo(inv.investigationId, "verifying");
      service.transitionTo(inv.investigationId, "completed");

      expect(() =>
        service.setHypothesisStatus(inv.investigationId, h1.id, "supported"),
      ).toThrow(InvestigationStateError);
    });
  });

  describe("transitionTo", () => {
    it("should follow the full happy path planning → investigating → verifying → completed", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");

      expect(
        service.transitionTo(inv.investigationId, "investigating").status,
      ).toBe("investigating");
      expect(
        service.transitionTo(inv.investigationId, "verifying").status,
      ).toBe("verifying");

      const completed = service.transitionTo(
        inv.investigationId,
        "completed",
      );
      expect(completed.status).toBe("completed");
      expect(completed.completedAt).toBeDefined();
    });

    it("should reject invalid transitions (planning → completed)", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");

      expect(() =>
        service.transitionTo(inv.investigationId, "completed"),
      ).toThrow(InvestigationStateError);
    });

    it("should reject skipping states (planning → verifying)", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");

      expect(() =>
        service.transitionTo(inv.investigationId, "verifying"),
      ).toThrow(InvestigationStateError);
    });

    it("should reject transitions out of terminal states", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      service.transitionTo(inv.investigationId, "investigating");
      service.transitionTo(inv.investigationId, "verifying");
      service.transitionTo(inv.investigationId, "completed");

      expect(() =>
        service.transitionTo(inv.investigationId, "investigating"),
      ).toThrow(InvestigationStateError);
    });

    it("should reject transition from failed", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      service.fail(inv.investigationId);

      expect(() =>
        service.transitionTo(inv.investigationId, "investigating"),
      ).toThrow(InvestigationStateError);
    });

    it("should throw InvestigationNotFoundError for unknown IDs", () => {
      expect(() =>
        service.transitionTo("investigation-999", "investigating"),
      ).toThrow(InvestigationNotFoundError);
    });
  });

  describe("fail", () => {
    it("should transition to failed and store the reason", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      service.transitionTo(inv.investigationId, "investigating");

      const failed = service.fail(
        inv.investigationId,
        "Analysis engine crashed",
      );

      expect(failed.status).toBe("failed");
      expect(failed.error).toBe("Analysis engine crashed");
      expect(failed.completedAt).toBeUndefined();
    });

    it("should preserve partial evidence when failing (PRD §19)", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      service.attachEvidence(inv.investigationId, "evidence-001");
      service.attachEvidence(inv.investigationId, "evidence-002");

      const failed = service.fail(inv.investigationId, "interrupted");

      expect(failed.status).toBe("failed");
      expect(failed.evidenceIds).toEqual([
        "evidence-001",
        "evidence-002",
      ]);
    });

    it("should allow failing directly from planning", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      const failed = service.fail(inv.investigationId);
      expect(failed.status).toBe("failed");
      expect(failed.error).toBeUndefined();
    });

    it("should reject failing an already-terminal investigation", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      service.fail(inv.investigationId, "first failure");

      expect(() =>
        service.fail(inv.investigationId, "second failure"),
      ).toThrow(InvestigationStateError);
    });
  });

  describe("attachEvidence", () => {
    it("should link evidence IDs in order", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");

      service.attachEvidence(inv.investigationId, "evidence-001");
      service.attachEvidence(inv.investigationId, "evidence-002");

      expect(
        service.getInvestigation(inv.investigationId).evidenceIds,
      ).toEqual(["evidence-001", "evidence-002"]);
    });

    it("should ignore duplicate links", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");

      service.attachEvidence(inv.investigationId, "evidence-001");
      service.attachEvidence(inv.investigationId, "evidence-001");

      expect(
        service.getInvestigation(inv.investigationId).evidenceIds,
      ).toEqual(["evidence-001"]);
    });

    it("should reject links on a terminal investigation", () => {
      const inv = service.createInvestigation("dataset-001", "Goal");
      service.transitionTo(inv.investigationId, "investigating");
      service.transitionTo(inv.investigationId, "verifying");
      service.transitionTo(inv.investigationId, "completed");

      expect(() =>
        service.attachEvidence(inv.investigationId, "evidence-001"),
      ).toThrow(InvestigationStateError);
    });
  });

  describe("serialize", () => {
    it("should produce JSON that round-trips (AC-08)", () => {
      const inv = service.createInvestigation(
        "dataset-001",
        "Why did revenue decline?",
      );
      service.addHypothesis(
        inv.investigationId,
        "Sales volume decreased.",
        "Volume dropped in Q3",
      );
      service.transitionTo(inv.investigationId, "investigating");
      service.attachEvidence(inv.investigationId, "evidence-001");

      const json = service.serialize(inv.investigationId);
      const parsed = JSON.parse(json) as Investigation;

      expect(parsed.investigationId).toBe("investigation-001");
      expect(parsed.datasetId).toBe("dataset-001");
      expect(parsed.goal).toBe("Why did revenue decline?");
      expect(parsed.status).toBe("investigating");
      expect(parsed.hypotheses).toHaveLength(1);
      expect(parsed.hypotheses[0]!.id).toBe("H1");
      expect(parsed.hypotheses[0]!.rationale).toBe("Volume dropped in Q3");
      expect(parsed.evidenceIds).toEqual(["evidence-001"]);
      expect(parsed.createdAt).toBeDefined();
      expect(parsed.updatedAt).toBeDefined();
    });
  });
});
