/**
 * InvestigationService for dsh-data-analyst.
 *
 * Manages the investigation lifecycle (PRD §19 state machine):
 *
 *   planning → investigating → verifying → completed
 *   any non-terminal state → failed (partial evidence preserved)
 *
 * Also manages hypotheses (PRD §14) and the evidence links (PRD §18).
 *
 * The service is deliberately deterministic: it never generates
 * hypotheses or interprets data — the LLM (reasoning layer, PRD §10.1)
 * proposes hypotheses and chooses analyses; this service only tracks
 * state. All state is plain JSON, so investigations are serializable
 * for reproducibility (AC-08, PRD §22).
 */

import type { Hypothesis, HypothesisStatus } from "../models/hypothesis.js";
import type {
  Investigation,
  InvestigationStatus,
} from "../models/investigation.js";
import {
  isTerminalInvestigationStatus,
  isValidStatusTransition,
} from "../models/investigation.js";
import { nextId } from "../utils/id-generator.js";
import {
  DataAnalystError,
  HypothesisNotFoundError,
  InvestigationNotFoundError,
  InvestigationStateError,
} from "../utils/errors.js";

export class InvestigationService {
  private readonly investigations: Map<string, Investigation> = new Map();

  /**
   * Create a new investigation for a loaded dataset.
   *
   * The investigation starts in "planning" status (PRD §13 output:
   * { investigation_id, goal, status: "planning" }).
   *
   * @throws DataAnalystError if the goal is empty
   */
  createInvestigation(datasetId: string, goal: string): Investigation {
    const trimmedGoal = goal?.trim() ?? "";
    if (trimmedGoal === "") {
      throw new DataAnalystError(
        "INVALID_GOAL",
        "Investigation goal must be a non-empty string",
        { datasetId },
      );
    }

    const now = new Date().toISOString();
    const investigation: Investigation = {
      investigationId: nextId("investigation"),
      datasetId,
      goal: trimmedGoal,
      status: "planning",
      hypotheses: [],
      evidenceIds: [],
      createdAt: now,
      updatedAt: now,
    };

    this.investigations.set(investigation.investigationId, investigation);
    return investigation;
  }

  /**
   * Retrieve an investigation by ID.
   * @throws InvestigationNotFoundError if no investigation has this ID
   */
  getInvestigation(investigationId: string): Investigation {
    const investigation = this.investigations.get(investigationId);
    if (investigation === undefined) {
      throw new InvestigationNotFoundError(investigationId);
    }
    return investigation;
  }

  /** Return all investigations in creation order. */
  listInvestigations(): Investigation[] {
    return Array.from(this.investigations.values());
  }

  /**
   * Propose a hypothesis for an investigation (PRD §14).
   *
   * Hypothesis IDs are per-investigation and sequential: "H1", "H2", ...
   * matching the PRD examples. New hypotheses start in "proposed" status.
   *
   * @throws InvestigationNotFoundError / InvestigationStateError if the
   *         investigation is missing or terminal
   * @throws DataAnalystError if the statement is empty
   */
  addHypothesis(
    investigationId: string,
    statement: string,
    rationale?: string,
  ): Hypothesis {
    const investigation = this.assertMutable(investigationId);

    const trimmedStatement = statement?.trim() ?? "";
    if (trimmedStatement === "") {
      throw new DataAnalystError(
        "INVALID_HYPOTHESIS",
        "Hypothesis statement must be a non-empty string",
        { investigationId },
      );
    }

    const hypothesis: Hypothesis = {
      id: `H${investigation.hypotheses.length + 1}`,
      investigationId,
      statement: trimmedStatement,
      status: "proposed",
    };

    if (rationale !== undefined && rationale.trim() !== "") {
      hypothesis.rationale = rationale.trim();
    }

    investigation.hypotheses.push(hypothesis);
    investigation.updatedAt = new Date().toISOString();
    return hypothesis;
  }

  /**
   * Update a hypothesis status (e.g. "proposed" → "testing" → "supported").
   *
   * @throws HypothesisNotFoundError if the hypothesis is not part of
   *         this investigation
   */
  setHypothesisStatus(
    investigationId: string,
    hypothesisId: string,
    status: HypothesisStatus,
  ): Hypothesis {
    const investigation = this.assertMutable(investigationId);

    const hypothesis = investigation.hypotheses.find(
      (h) => h.id === hypothesisId,
    );
    if (hypothesis === undefined) {
      throw new HypothesisNotFoundError(hypothesisId, investigationId);
    }

    hypothesis.status = status;
    investigation.updatedAt = new Date().toISOString();
    return hypothesis;
  }

  /**
   * Transition the investigation to a new status, enforcing the PRD §19
   * state machine. "completed" sets completedAt.
   *
   * @throws InvestigationStateError if the transition is not allowed
   */
  transitionTo(
    investigationId: string,
    newStatus: InvestigationStatus,
  ): Investigation {
    const investigation = this.getInvestigation(investigationId);

    if (!isValidStatusTransition(investigation.status, newStatus)) {
      throw new InvestigationStateError(
        investigationId,
        investigation.status,
        `invalid transition to "${newStatus}"`,
      );
    }

    investigation.status = newStatus;
    investigation.updatedAt = new Date().toISOString();

    if (newStatus === "completed") {
      investigation.completedAt = investigation.updatedAt;
    }

    return investigation;
  }

  /**
   * Mark an investigation as failed, preserving all partial evidence
   * (PRD §19). The failure reason is stored on the investigation.
   *
   * @throws InvestigationStateError if the investigation is already terminal
   */
  fail(investigationId: string, reason?: string): Investigation {
    const investigation = this.transitionTo(investigationId, "failed");

    if (reason !== undefined && reason.trim() !== "") {
      investigation.error = reason.trim();
    }

    return investigation;
  }

  /**
   * Link a evidence record to an investigation (PRD §18 evidence graph).
   * Duplicate links are ignored.
   *
   * @throws InvestigationStateError if the investigation is terminal
   */
  attachEvidence(investigationId: string, evidenceId: string): void {
    const investigation = this.assertMutable(investigationId);

    if (!investigation.evidenceIds.includes(evidenceId)) {
      investigation.evidenceIds.push(evidenceId);
      investigation.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Serialize the full investigation state to JSON (AC-08, PRD §22).
   * The output is the "investigation/" artifact set's core document.
   */
  serialize(investigationId: string): string {
    return JSON.stringify(this.getInvestigation(investigationId), null, 2);
  }

  /**
   * Return the investigation if it exists and is in a mutable
   * (non-terminal) state. Used internally and by EvidenceService.
   *
   * @throws InvestigationNotFoundError / InvestigationStateError
   */
  assertMutable(investigationId: string): Investigation {
    const investigation = this.getInvestigation(investigationId);

    if (isTerminalInvestigationStatus(investigation.status)) {
      throw new InvestigationStateError(
        investigationId,
        investigation.status,
        "investigation is terminal and cannot be modified",
      );
    }

    return investigation;
  }
}
