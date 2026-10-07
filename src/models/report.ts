/**
 * InvestigationReport model for dsh-data-analyst (M7.1).
 *
 * A report is a structured, deterministic snapshot of an
 * already-completed investigation. It assembles existing state only:
 *
 *   - no new analysis
 *   - no new evidence
 *   - no new findings
 *   - no hypothesis or verification mutations
 *   - no LLM calls, no causal claims, no invented information
 *
 * The whole object is plain JSON, so reports are serializable
 * for reproducibility (PRD §22).
 */

import type { EvidenceType } from "./evidence.js";
import type { VerificationStatus } from "./finding.js";
import type { HypothesisStatus } from "./hypothesis.js";
import type { InvestigationStatus } from "./investigation.js";

export type ReportInvestigation = {
  id: string;
  goal: string;
  status: InvestigationStatus;
};

export type ReportHypothesis = {
  id: string;
  statement: string;
  status: HypothesisStatus;
  rationale?: string | undefined;
};

export type ReportEvidence = {
  id: string;
  type: EvidenceType;
  operation: string;
  input: unknown;
  result: unknown;
};

export type ReportFinding = {
  id: string;
  claim: string;
  evidenceIds: string[];
  hypothesisIds?: string[] | undefined;
  confidence: number;
  verificationStatus: VerificationStatus;
  verificationReason?: string | undefined;
};

export type ReportVerificationSummary = {
  /** Number of findings included in the report. */
  findings: number;
  /** Number of findings whose status is "verified". */
  verified: number;
  /** Number of findings whose status is "rejected". */
  rejected: number;
  /** Number of findings whose status is "unverified". */
  unverified: number;
};

export type InvestigationReport = {
  investigation: ReportInvestigation;
  hypotheses: ReportHypothesis[];
  evidence: ReportEvidence[];
  findings: ReportFinding[];
  verification: ReportVerificationSummary;
  /** Deterministic text derived ONLY from existing findings. */
  summary: string;
  /**
   * Limitations explicitly represented by existing investigation /
   * evidence state. Never invented; empty when none apply.
   */
  limitations: string[];
};
