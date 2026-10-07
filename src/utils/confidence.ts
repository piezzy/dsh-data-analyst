/**
 * Deterministic confidence calculation for findings (PRD §21, §28).
 *
 * PRD §21: "Confidence must not equal model certainty." Confidence
 * is therefore COMPUTED from objective signals available when the
 * finding is recorded, never assigned by the LLM:
 *
 *   confidence = 0.5 * evidenceScore + 0.5 * hypothesisScore
 *
 *   evidenceScore  = min(evidenceCount / 3, 1)
 *     1 evidence → 0.33, 2 → 0.67, 3+ → 1.0
 *
 *   hypothesisScore = supportedHypotheses / linkedHypotheses
 *     (0.5 — neutral — when no hypotheses are linked)
 *
 * The result is rounded to 2 decimal places. The calculation is
 * pure and deterministic: identical inputs always produce identical
 * confidence.
 *
 * A caller may still supply an explicit confidence (validated to
 * [0, 1] by the FindingService); the calculated value is the
 * default when none is supplied.
 */

/** Number of evidence records at which the evidence score saturates. */
const EVIDENCE_SCORE_SATURATION = 3;

/** Neutral hypothesis score when a finding links no hypotheses. */
const NEUTRAL_HYPOTHESIS_SCORE = 0.5;

/**
 * Calculate finding confidence from evidence availability and
 * hypothesis support.
 *
 * @param evidenceCount - Number of evidence records backing the finding
 * @param hypothesisSupportRatio - Ratio of "supported" hypotheses among
 *   the linked hypotheses, or null when no hypotheses are linked
 * @returns Confidence in [0, 1], rounded to 2 decimals
 */
export function calculateConfidence(
  evidenceCount: number,
  hypothesisSupportRatio: number | null,
): number {
  const evidenceScore = Math.min(
    evidenceCount / EVIDENCE_SCORE_SATURATION,
    1,
  );

  const hypothesisScore =
    hypothesisSupportRatio === null
      ? NEUTRAL_HYPOTHESIS_SCORE
      : hypothesisSupportRatio;

  const confidence =
    0.5 * evidenceScore + 0.5 * hypothesisScore;

  return Math.round(confidence * 100) / 100;
}

/**
 * Compute the hypothesis support ratio for a set of hypothesis
 * statuses: the fraction whose status is "supported".
 *
 * @returns Ratio in [0, 1], or null when no hypotheses are linked
 */
export function hypothesisSupportRatio(
  statuses: readonly string[],
): number | null {
  if (statuses.length === 0) {
    return null;
  }

  const supported = statuses.filter(
    (status) => status === "supported",
  ).length;

  return supported / statuses.length;
}
