/**
 * Investigation model for dsh-data-analyst.
 *
 * PRD §13 (start_investigation), §19 (state machine), §22 (reproducibility).
 *
 * An investigation is the container for one analytical goal. It owns the
 * hypotheses proposed for the goal (PRD §14) and references the evidence
 * collected while testing them (PRD §15). Findings (PRD §16) arrive in M5.
 *
 * State machine (PRD §19):
 *
 *   planning → investigating → verifying → completed
 *   any non-terminal state → failed
 *
 * Terminal states are final. When an investigation fails, partial evidence
 * is preserved (PRD §19) — evidence lives in the EvidenceService and the
 * evidenceIds links on this model are never cleared.
 *
 * The whole object is plain JSON, so investigation state is serializable
 * for reproducibility (AC-08, PRD §22).
 */

import type { Hypothesis } from "./hypothesis.js";

export type InvestigationStatus =
  | "planning"
  | "investigating"
  | "verifying"
  | "completed"
  | "failed";

export type Investigation = {
  investigationId: string;
  /** ID of the dataset under investigation (from DatasetService) */
  datasetId: string;
  /** The analytical goal, e.g. "Why did revenue decline in Q3?" */
  goal: string;
  status: InvestigationStatus;
  /** Hypotheses proposed for this goal, in proposal order */
  hypotheses: Hypothesis[];
  /** IDs of evidence records linked to this investigation, in recording order */
  evidenceIds: string[];
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 timestamp of the last mutation */
  updatedAt: string;
  /** ISO 8601 timestamp, set when the investigation completes */
  completedAt?: string;
  /** Failure reason, set when the investigation fails */
  error?: string;
};

export const INVESTIGATION_STATUSES: readonly InvestigationStatus[] = [
  "planning",
  "investigating",
  "verifying",
  "completed",
  "failed",
];

export const TERMINAL_INVESTIGATION_STATUSES: readonly InvestigationStatus[] = [
  "completed",
  "failed",
];

/**
 * Valid state transitions (PRD §19).
 *
 *   planning     → investigating, failed
 *   investigating → verifying, failed
 *   verifying    → completed, failed
 *   completed    → (terminal)
 *   failed       → (terminal)
 */
export const VALID_STATUS_TRANSITIONS: Readonly<
  Record<InvestigationStatus, readonly InvestigationStatus[]>
> = {
  planning: ["investigating", "failed"],
  investigating: ["verifying", "failed"],
  verifying: ["completed", "failed"],
  completed: [],
  failed: [],
};

export function isInvestigationStatus(value: unknown): value is InvestigationStatus {
  return (
    typeof value === "string" &&
    (INVESTIGATION_STATUSES as readonly string[]).includes(value)
  );
}

export function isTerminalInvestigationStatus(
  status: InvestigationStatus,
): boolean {
  return (TERMINAL_INVESTIGATION_STATUSES as readonly string[]).includes(status);
}

export function isValidStatusTransition(
  from: InvestigationStatus,
  to: InvestigationStatus,
): boolean {
  return (VALID_STATUS_TRANSITIONS[from] ?? []).includes(to);
}
