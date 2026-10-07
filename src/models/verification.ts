/**
 * Verification result models for dsh-data-analyst.
 *
 * PRD §17: Verification must answer "Does the evidence actually
 * support the claim?" — deterministically, by re-executing the
 * analysis behind each piece of evidence and comparing the
 * recomputed result against the recorded result.
 *
 * The verification result deliberately keeps four DISTINCT concepts
 * (they are not collapsed into a single boolean):
 *
 *   1. evidence exists        — the referenced evidence ID is known
 *   2. structurally valid     — the evidence record is well-formed
 *   3. reproducible           — the evidence can be re-executed
 *                               deterministically by the analysis engine
 *   4. supported / matches    — the recomputed result equals the
 *                               recorded result
 */

import type { VerificationStatus } from "./finding.js";

/**
 * Per-evidence verification detail. One entry per evidence ID
 * referenced by the finding.
 */
export type EvidenceVerification = {
  evidenceId: string;

  /** Concept 1: does the evidence ID exist in the evidence store? */
  exists: boolean;

  /** Concept 2: is the evidence record structurally well-formed? */
  structurallyValid: boolean;

  /** Does the evidence belong to the same investigation as the finding? */
  sameInvestigation: boolean;

  /**
   * Concept 3: can the evidence be reproduced by deterministically
   * re-executing the corresponding analysis engine operation?
   */
  reproducible: boolean;

  /** The originally recorded result (expected value), when available */
  recordedResult?: unknown;

  /** The recomputed result (actual value), when reproducible */
  reproducedResult?: unknown;

  /**
   * Concept 4: do the recorded and recomputed results match?
   * Undefined when the evidence could not be reproduced.
   */
  matches?: boolean;

  /** Why the evidence is invalid or non-reproducible, when applicable */
  reason?: string;
};

/**
 * Structured verification result (PRD §17 output, extended).
 *
 * Preserves enough information to explain the verification:
 * what was verified, which evidence was checked, the expected
 * (recorded) and actual (recomputed) results, whether they match,
 * the overall status, and the reason for rejection.
 */
export type VerificationResult = {
  findingId: string;
  investigationId: string;
  /** The claim that was verified, for self-contained results */
  claim: string;
  status: VerificationStatus;
  reason: string;
  /** Per-evidence verification details, in the finding's evidence order */
  checkedEvidence: EvidenceVerification[];
  /** ISO 8601 timestamp of the verification run */
  verifiedAt: string;
};
