/**
 * M9 investigation-loop policy abstraction.
 *
 * The policy decides WHAT to investigate next; the deterministic analysis
 * engine performs all calculations. Policy output is DATA ONLY — a closed
 * vocabulary of decisions with no executable content (no code, no SQL,
 * no shell). The loop driver validates every decision and treats anything
 * outside the vocabulary as STOP, so a future LLM policy can plug in
 * behind this interface without redesigning the loop.
 */

import type { HypothesisStatus } from "../models/hypothesis.js";

/** Bounded-loop safety limits. */
export const DEFAULT_MAX_ROUNDS = 5;
export const DEFAULT_MAX_EVIDENCE = 12;

/** Read-only hypothesis summary handed to the policy. */
export interface PolicyHypothesisSummary {
  id: string;
  statement: string;
  status: HypothesisStatus;
  readonly rationale?: string | undefined;
}

export type PolicyVerdict = "supported" | "rejected" | "inconclusive";

export type PolicyAnalysisType = "aggregate" | "compare" | "trend";

/**
 * Bounded per-column profile facts for policy prompts. Small and
 * deterministic: names, types, missing counts, and top categorical values.
 * Full distributions and row data are never included.
 */
export interface PolicyProfileSummary {
  columns: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly nullable: boolean;
    readonly missingCount: number;
    readonly topValues?: readonly string[] | undefined;
  }>;
}

/**
 * Bounded per-evidence digest for policy prompts. Summaries only — full
 * result payloads (e.g. multi-hundred-period trends) are never included.
 */
export interface PolicyEvidenceSummary {
  evidenceId: string;
  operation: string;
  round?: number | undefined;
  /** Compact one-line digest, e.g. groups involved and first/last values. */
  digest: string;
  resultRows: number;
}

/**
 * Read-only loop context for one policy decision. All fields are plain
 * JSON data; the policy must not mutate them.
 */
export interface InvestigationPolicyContext {
  goal: string;
  /** Completed rounds so far (1-based after the first analysis). */
  round: number;
  maxRounds: number;
  maxEvidence: number;
  hypotheses: readonly PolicyHypothesisSummary[];
  /** Seed/refinement plans still queued (not yet executed). */
  pendingPlans: number;
  evidenceCount: number;
  lastVerdict: PolicyVerdict | null;
  lastAnalysisType: PolicyAnalysisType | null;
  consecutiveRoundsWithoutEvidence: number;
  /** Optional bounded dataset facts for LLM-backed policies. */
  profileSummary?: PolicyProfileSummary | undefined;
  /** Optional bounded digests of recent evidence, latest first. */
  evidenceSummaries?: readonly PolicyEvidenceSummary[] | undefined;
}

/**
 * Follow-up derivation strategies. The policy names a strategy; the loop
 * driver maps it to a concrete AnalysisEngine request built only from the
 * dataset profile and recorded evidence. The policy never authors requests.
 */
export type RefineStrategy = "DESCRIPTIVE_FALLBACK" | "GROUP_DISTRIBUTION";

/**
 * Closed decision vocabulary. There is intentionally no way to express
 * executable content here.
 */
export type PolicyDecision =
  | { readonly kind: "STOP"; readonly reason: string }
  | { readonly kind: "TEST_NEXT" }
  | {
      readonly kind: "REFINE";
      readonly strategy: RefineStrategy;
      readonly reason: string;
    };

export interface InvestigationPolicy {
  /**
   * M10: may return a decision or a promise of one, so LLM-backed
   * policies can perform one async generation call. Synchronous policies
   * keep returning a plain decision; the driver awaits either form.
   */
  decide(
    ctx: InvestigationPolicyContext,
  ): PolicyDecision | Promise<PolicyDecision>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate an untrusted policy decision. Anything outside the closed
 * vocabulary becomes a safe STOP, so a misbehaving (or future LLM)
 * policy can never inject executable behavior into the loop.
 */
export function asValidDecision(raw: unknown): PolicyDecision {
  if (!isRecord(raw)) {
    return { kind: "STOP", reason: "invalid policy decision ignored" };
  }
  if (raw["kind"] === "STOP") {
    const reason =
      typeof raw["reason"] === "string" && raw["reason"].trim() !== ""
        ? raw["reason"]
        : "policy stopped";
    return { kind: "STOP", reason };
  }
  if (raw["kind"] === "TEST_NEXT") {
    return { kind: "TEST_NEXT" };
  }
  if (raw["kind"] === "REFINE") {
    const strategy = raw["strategy"];
    if (
      strategy === "DESCRIPTIVE_FALLBACK" ||
      strategy === "GROUP_DISTRIBUTION"
    ) {
      const reason =
        typeof raw["reason"] === "string" && raw["reason"].trim() !== ""
          ? raw["reason"]
          : "policy requested refinement";
      return { kind: "REFINE", strategy, reason };
    }
  }
  return { kind: "STOP", reason: "invalid policy decision ignored" };
}

/**
 * Deterministic M9 policy (no LLM, no I/O, no randomness).
 *
 * - Safety caps first: evidence budget, round budget, no-progress streak.
 * - Pending seed plans always run first (preserves M1–M8 behavior).
 * - After seeds are exhausted, an inconclusive last verdict earns exactly
 *   the follow-up rounds the budgets allow; anything else stops.
 */
export class DeterministicInvestigationPolicy implements InvestigationPolicy {
  decide(ctx: InvestigationPolicyContext): PolicyDecision {
    if (ctx.evidenceCount >= ctx.maxEvidence) {
      return { kind: "STOP", reason: "evidence budget reached" };
    }
    if (ctx.round >= ctx.maxRounds) {
      return { kind: "STOP", reason: "max rounds reached" };
    }
    if (ctx.consecutiveRoundsWithoutEvidence >= 2) {
      return { kind: "STOP", reason: "no new evidence produced" };
    }
    if (ctx.pendingPlans > 0) {
      return { kind: "TEST_NEXT" };
    }
    // One follow-up per inconclusive hypothesis: a refinement that is
    // itself inconclusive stops the chain instead of looping to maxRounds.
    const lastHypothesis = ctx.hypotheses[ctx.hypotheses.length - 1];
    const alreadyRefined =
      lastHypothesis?.rationale?.startsWith("Refines ") ?? false;
    if (
      ctx.lastVerdict === "inconclusive" &&
      !alreadyRefined &&
      ctx.round < ctx.maxRounds &&
      ctx.evidenceCount < ctx.maxEvidence
    ) {
      return {
        kind: "REFINE",
        strategy: "DESCRIPTIVE_FALLBACK",
        reason: "last hypothesis was inconclusive; running fallback analysis",
      };
    }
    const supported = ctx.hypotheses.some((h) => h.status === "supported");
    return {
      kind: "STOP",
      reason: supported
        ? "sufficient evidence: a hypothesis is supported"
        : "all hypotheses terminal",
    };
  }
}
