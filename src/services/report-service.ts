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
   * @throws InvestigationNotFoundError if the investigation does not exist
   */
  generateReport(investigationId: string): InvestigationReport {
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
      limitations: this.buildLimitations(investigationId, findings),
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
   * Limitations represented by existing state only. Currently that
   * is the set of unverified findings: when a finding has not been
   * deterministically verified, the report states that fact rather
   * than inventing data-quality caveats.
   */
  private buildLimitations(
    _investigationId: string,
    findings: ReportFinding[],
  ): string[] {
    const limitations: string[] = [];
    for (const finding of findings) {
      if (finding.verificationStatus === "unverified") {
        limitations.push(
          `Finding ${finding.id} is unverified and should not be treated as a confirmed conclusion.`,
        );
      }
    }
    return limitations;
  }
}
