/**
 * Finding model for dsh-data-analyst.
 *
 * PRD §16: A finding is a CLAIM backed by structured evidence.
 *
 * Invariant (PRD §16, AC-04):
 *
 *   finding.evidenceIds.length > 0
 *
 * A finding without evidence is invalid.
 *
 * Core principle (PRD §3, §10.3): "No unsupported insight."
 * A finding is NOT automatically verified just because it has
 * high confidence — verification is a separate, deterministic
 * step (PRD §17) performed by the VerificationService.
 */

/**
 * Verification status of a finding (PRD §16, AC-05).
 *
 * - "unverified": recorded but not yet verified (the default)
 * - "verified": deterministic verification confirmed the evidence
 * - "rejected": verification contradicted the evidence
 *
 * A finding must never silently appear as a verified conclusion.
 */
export type VerificationStatus =
  | "unverified"
  | "verified"
  | "rejected";

export type Finding = {
  id: string;
  investigationId: string;

  /** The analytical claim, e.g. "Revenue declined 18.2% in Q3." */
  claim: string;

  /** IDs of evidence records backing this claim (must be non-empty) */
  evidenceIds: string[];

  /** IDs of hypotheses this finding supports (optional) */
  hypothesisIds?: string[];

  /** Confidence in [0, 1] — computed or validated, never LLM-assigned blindly (PRD §21) */
  confidence: number;

  verificationStatus: VerificationStatus;

  /** Set by the VerificationService when the finding is verified or rejected */
  verificationReason?: string;
};

export const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  "unverified",
  "verified",
  "rejected",
];

export function isVerificationStatus(
  value: unknown,
): value is VerificationStatus {
  return (
    typeof value === "string" &&
    (VERIFICATION_STATUSES as readonly string[]).includes(value)
  );
}
