/**
 * ReportService for dsh-data-analyst (M7.1).
 *
 * Assembles a reproducible, deterministic snapshot of an
 * already-completed investigation into an InvestigationReport.
 *
 * Read-only by design: it never runs analysis, records evidence
 * or findings, mutates hypotheses, changes verification status,
 * calls an LLM, or invents information. Summary and limitations
 * are derived ONLY from existing investigation state.
 */

import type { Evidence } from "../models/evidence.js";
import type { Finding } from "../models/finding.js";
import type {
  InvestigationReport,
  ReportEvidence,
  ReportFinding,
  ReportHypothesis,
  ReportVerificationSummary,
} from "../models/report.js";
import type { EvidenceService } from "./evidence-service.js";
import type { FindingService } from "./finding-service.js";
import type { InvestigationService } from "./investigation-service.js";
import type { VerificationService } from "./verification-service.js";

/**
 * Dataset facts a caller may attach for limitation rendering.
 * Every field is a precomputed count from profiling the dataset
 * before the investigation ran — the report performs no analysis
 * of its own. All fields optional; absent fields render nothing.
 */
export interface ReportDataQualityContext {
  /** Rows identical to another row, as counted by profiling. */
  duplicateRows?: number | undefined;
  /** Missing (null/empty) value counts by column, in schema order. */
  missingValues?: Record<string, number> | undefined;
}

export class ReportService {
  constructor(
    private readonly investigationService: InvestigationService,
    private readonly evidenceService: EvidenceService,
    private readonly findingService: FindingService,
    private readonly verificationService: VerificationService,
  ) {}

  /**
   * Assemble a snapshot report for an investigation.
   *
   * @param dataQuality - optional dataset facts the caller already
   *   computed (e.g. from profiling before the investigation ran).
   *   The report never profiles or analyzes; it only renders the
   *   provided counts as limitations. Omit it to keep the
   *   pre-M13.3 behavior.
   * @throws InvestigationNotFoundError if the investigation does not exist
   */
  generateReport(
    investigationId: string,
    dataQuality?: ReportDataQualityContext,
  ): InvestigationReport {
    // Validates existence; throws InvestigationNotFoundError when unknown.
    const investigation =
      this.investigationService.getInvestigation(investigationId);

    const hypotheses: ReportHypothesis[] = investigation.hypotheses.map(
      (h) => {
        const entry: ReportHypothesis = {
          id: h.id,
          statement: h.statement,
          status: h.status,
        };
        if (h.rationale !== undefined) {
          entry.rationale = h.rationale;
        }
        return entry;
      },
    );

    const evidenceRecords: Evidence[] =
      this.evidenceService.getEvidenceForInvestigation(investigationId);
    const evidence: ReportEvidence[] = evidenceRecords.map((e) => ({
      id: e.id,
      type: e.type,
      operation: e.operation,
      input: e.input,
      result: e.result,
    }));

    const findingRecords: Finding[] =
      this.findingService.getFindingsForInvestigation(investigationId);
    const findings: ReportFinding[] = findingRecords.map((f) => {
      const entry: ReportFinding = {
        id: f.id,
        claim: f.claim,
        evidenceIds: [...f.evidenceIds],
        confidence: f.confidence,
        verificationStatus: f.verificationStatus,
      };
      if (f.hypothesisIds !== undefined) {
        entry.hypothesisIds = [...f.hypothesisIds];
      }
      // Prefer the latest structured verification result when available;
      // fall back to the finding's stored reason (also existing state).
      const latest = this.verificationService.getVerificationResult(f.id);
      const reason = latest?.reason ?? f.verificationReason;
      if (reason !== undefined) {
        entry.verificationReason = reason;
      }
      return entry;
    });

    const verification: ReportVerificationSummary = {
      findings: findings.length,
      verified: findings.filter((f) => f.verificationStatus === "verified")
        .length,
      rejected: findings.filter((f) => f.verificationStatus === "rejected")
        .length,
      unverified: findings.filter(
        (f) => f.verificationStatus === "unverified",
      ).length,
    };

    return {
      investigation: {
        id: investigation.investigationId,
        goal: investigation.goal,
        status: investigation.status,
      },
      hypotheses,
      evidence,
      findings,
      verification,
      summary: this.buildSummary(findings, verification),
      limitations: this.buildLimitations(
        investigation.hypotheses.map((h) => ({ id: h.id, status: h.status })),
        evidence,
        findings,
        dataQuality,
      ),
    };
  }

  /**
   * Deterministic summary derived ONLY from existing findings.
   * No causal language is introduced; claims are never restated
   * as explanations.
   */
  private buildSummary(
    findings: ReportFinding[],
    verification: ReportVerificationSummary,
  ): string {
    if (findings.length === 0) {
      return "Investigation produced no findings.";
    }
    const noun = findings.length === 1 ? "finding" : "findings";
    const parts: string[] = [
      `Investigation produced ${findings.length} ${noun}.`,
    ];
    if (verification.verified > 0) {
      parts.push(
        `${verification.verified} ${verification.verified === 1 ? "finding was" : "findings were"} verified.`,
      );
    }
    if (verification.rejected > 0) {
      parts.push(
        `${verification.rejected} ${verification.rejected === 1 ? "finding was" : "findings were"} rejected.`,
      );
    }
    if (verification.unverified > 0) {
      parts.push(
        `${verification.unverified} ${verification.unverified === 1 ? "finding remains" : "findings remain"} unverified.`,
      );
    }
    return parts.join(" ");
  }

  /**
   * Limitations explicitly represented by existing investigation /
   * evidence state. Every rule below reads recorded state only:
   *
   * - finding verification outcomes (unverified / rejected)
   * - hypothesis terminal states (inconclusive)
   * - trend evidence carrying the caller-recorded `unfilteredPeriod`
   *   marker (the engine has no period filter; the marker is written
   *   when the goal requested a period)
   * - caller-provided profiling counts (duplicate rows, per-column
   *   missing values the engine skips during aggregation)
   *
   * Deterministic and ordered: findings, hypotheses, evidence, then
   * data-quality facts. Empty when none apply ("None identified").
   */
  private buildLimitations(
    hypotheses: ReadonlyArray<{ id: string; status: string }>,
    evidence: ReportEvidence[],
    findings: ReportFinding[],
    dataQuality?: ReportDataQualityContext,
  ): string[] {
    const limitations: string[] = [];
    for (const finding of findings) {
      if (finding.verificationStatus === "unverified") {
        limitations.push(
          `Finding ${finding.id} is unverified and should not be treated as a confirmed conclusion.`,
        );
      } else if (finding.verificationStatus === "rejected") {
        limitations.push(
          `Finding ${finding.id} was rejected during verification and should not be treated as a confirmed conclusion.`,
        );
      }
    }
    for (const hypothesis of hypotheses) {
      if (hypothesis.status === "inconclusive") {
        limitations.push(
          `Hypothesis ${hypothesis.id} ended inconclusive: the recorded evidence neither supported nor rejected it.`,
        );
      }
    }
    const reportedPeriods = new Set<string>();
    for (const item of evidence) {
      const input = item.input as { unfilteredPeriod?: unknown } | null;
      const period =
        typeof input?.unfilteredPeriod === "string" &&
        input.unfilteredPeriod.trim() !== ""
          ? input.unfilteredPeriod.trim()
          : null;
      if (period !== null && !reportedPeriods.has(period)) {
        reportedPeriods.add(period);
        limitations.push(
          `Requested time period "${period}" could not be applied by the analysis engine; the trend covers the full data range.`,
        );
      }
    }
    if (
      dataQuality?.duplicateRows !== undefined &&
      dataQuality.duplicateRows > 0
    ) {
      const n = dataQuality.duplicateRows;
      limitations.push(
        `Dataset contains ${n} duplicate row${n === 1 ? "" : "s"}; aggregates count duplicate rows as recorded.`,
      );
    }
    const missing = dataQuality?.missingValues;
    if (missing !== undefined) {
      for (const [column, count] of Object.entries(missing)) {
        if (typeof count === "number" && count > 0) {
          limitations.push(
            `Column '${column}' has ${count} missing value${count === 1 ? "" : "s"}; missing values are excluded from aggregations.`,
          );
        }
      }
    }
    return limitations;
  }
}
