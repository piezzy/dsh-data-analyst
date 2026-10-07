/**
 * MarkdownReportRenderer for dsh-data-analyst (M7.2).
 *
 * Pure, deterministic transformation of an existing InvestigationReport
 * into Markdown. It never runs analysis, touches datasets or services,
 * mutates state, calls an LLM, or performs new reasoning.
 */

import type {
  InvestigationReport,
  ReportEvidence,
  ReportFinding,
  ReportHypothesis,
} from "../models/report.js";

function titleCase(status: string): string {
  if (status.length === 0) return status;
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

/**
 * Collapse untrusted text to a single line so multiline input can
 * never break the deterministic Markdown structure. Single-line
 * claims/goals/statements pass through unchanged.
 */
function toInline(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function formatScalar(value: unknown): string {
  if (typeof value === "string") return toInline(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) return "n/a";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderComparisonResult(result: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const baseGroup = result["baseGroup"];
  const baseValue = result["baseValue"];
  const compareGroup = result["compareGroup"];
  const compareValue = result["compareValue"];
  const absoluteDiff = result["absoluteDiff"];
  const percentageDiff = result["percentageDiff"];
  if (baseGroup !== undefined) {
    lines.push(`- Base group: ${toInline(String(baseGroup))}`);
  }
  if (typeof baseValue === "number" && Number.isFinite(baseValue)) {
    lines.push(`- Base value: ${String(baseValue)}`);
  }
  if (compareGroup !== undefined) {
    lines.push(`- Compare group: ${toInline(String(compareGroup))}`);
  }
  if (typeof compareValue === "number" && Number.isFinite(compareValue)) {
    lines.push(`- Compare value: ${String(compareValue)}`);
  }
  if (typeof absoluteDiff === "number" && Number.isFinite(absoluteDiff)) {
    lines.push(`- Difference: ${String(absoluteDiff)}`);
  }
  if (typeof percentageDiff === "number" && Number.isFinite(percentageDiff)) {
    lines.push(`- Percentage difference: ${String(percentageDiff)}%`);
  }
  return lines;
}

function renderInputLines(input: unknown): string[] {
  if (!isRecord(input)) {
    if (input === undefined) return [];
    return [`- Input: ${formatScalar(input)}`];
  }
  const lines: string[] = [];
  const pick = (label: string, value: unknown): void => {
    if (value === undefined || value === null || value === "") return;
    if (typeof value === "string") {
      const inline = toInline(value);
      if (inline === "") return;
      lines.push(`- ${label}: ${inline}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`- ${label}: ${String(value)}`);
    }
  };
  pick("Group column", input["groupColumn"]);
  pick("Value column", input["valueColumn"]);
  pick("Function", input["func"]);
  pick("Base group", input["baseGroup"]);
  pick("Compare group", input["compareGroup"]);
  pick("Time column", input["timeColumn"]);
  pick("Group by", input["groupBy"]);
  pick("Dataset", input["datasetId"]);
  return lines;
}


function renderResultLines(result: unknown): string[] {
  if (isRecord(result)) {
    const hasCompareShape =
      result["baseValue"] !== undefined ||
      result["compareValue"] !== undefined ||
      result["baseGroup"] !== undefined ||
      result["compareGroup"] !== undefined;
    if (hasCompareShape) {
      return renderComparisonResult(result);
    }
    return [`- Result: ${formatScalar(result)}`];
  }
  if (Array.isArray(result)) {
    if (result.length === 0) return ["- Result: no rows."];
    const rows = result as Array<Record<string, unknown>>;
    const first = rows[0];
    if (first !== undefined && isRecord(first)) {
      const columns = Object.keys(first);
      const header = `| ${columns.map((c) => toInline(c)).join(" | ")} |`;
      const divider = `| ${columns.map(() => "---").join(" | ")} |`;
      const body = rows.slice(0, 20).map((row) => {
        const cells = columns.map((c) =>
          formatScalar((row as Record<string, unknown>)[c]),
        );
        return `| ${cells.join(" | ")} |`;
      });
      const lines = ["- Result:", "", header, divider, ...body];
      if (rows.length > 20) {
        lines.push("", `- (${rows.length - 20} more row(s) omitted.)`);
      }
      return lines;
    }
    return [`- Result: ${formatScalar(result)}`];
  }
  if (result === undefined) return [];
  return [`- Result: ${formatScalar(result)}`];
}

function renderHypothesis(h: ReportHypothesis): string[] {
  const lines: string[] = [];
  lines.push(`### ${toInline(h.id)} — ${titleCase(h.status)}`);
  lines.push("");
  const statement = toInline(h.statement);
  lines.push(statement === "" ? "(no statement recorded)" : statement);
  lines.push("");
  if (h.rationale !== undefined && toInline(h.rationale) !== "") {
    lines.push(`Rationale: ${toInline(h.rationale)}`);
    lines.push("");
  }
  return lines;
}

function renderEvidence(item: ReportEvidence, index: number): string[] {
  const lines: string[] = [];
  lines.push(`### E${index + 1} — ${toInline(item.type)}`);
  lines.push("");
  lines.push(`- ID: ${toInline(item.id)}`);
  lines.push(`- Operation: ${toInline(item.operation)}`);
  lines.push(...renderInputLines(item.input));
  lines.push(...renderResultLines(item.result));
  lines.push("");
  return lines;
}

function renderFinding(f: ReportFinding, index: number): string[] {
  const lines: string[] = [];
  const claim = toInline(f.claim);
  lines.push(
    `### ${index + 1}. ${claim === "" ? "(no claim recorded)" : claim}`,
  );
  lines.push("");
  lines.push(`Confidence: ${String(f.confidence)}`);
  lines.push(`Verification: ${titleCase(f.verificationStatus)}`);
  lines.push(`Evidence: ${f.evidenceIds.map((id) => toInline(id)).join(", ")}`);
  if (f.hypothesisIds !== undefined && f.hypothesisIds.length > 0) {
    lines.push(
      `Hypotheses: ${f.hypothesisIds.map((id) => toInline(id)).join(", ")}`,
    );
  }
  if (
    f.verificationReason !== undefined &&
    toInline(f.verificationReason) !== ""
  ) {
    lines.push(`Reason: ${toInline(f.verificationReason)}`);
  }
  lines.push("");
  return lines;
}

export class MarkdownReportRenderer {
  render(report: InvestigationReport): string {
    const out: string[] = [];
    out.push("# Investigation Report");
    out.push("");
    out.push("## Goal");
    out.push("");
    const goal = toInline(report.investigation.goal);
    out.push(goal === "" ? "(no goal recorded)" : goal);
    out.push("");
    out.push("## Investigation");
    out.push("");
    out.push(`- Status: ${toInline(report.investigation.status)}`);
    out.push(`- Investigation ID: ${toInline(report.investigation.id)}`);
    out.push("");
    out.push("## Hypotheses");
    out.push("");
    if (report.hypotheses.length === 0) {
      out.push("No hypotheses recorded.");
      out.push("");
    } else {
      for (const h of report.hypotheses) {
        out.push(...renderHypothesis(h));
      }
    }
    out.push("## Evidence");
    out.push("");
    if (report.evidence.length === 0) {
      out.push("No evidence recorded.");
      out.push("");
    } else {
      report.evidence.forEach((e, i) => {
        out.push(...renderEvidence(e, i));
      });
    }
    out.push("## Findings");
    out.push("");
    if (report.findings.length === 0) {
      out.push("No findings recorded.");
      out.push("");
    } else {
      report.findings.forEach((f, i) => {
        out.push(...renderFinding(f, i));
      });
    }
    out.push("## Verification");
    out.push("");
    out.push(`- Findings: ${String(report.verification.findings)}`);
    out.push(`- Verified: ${String(report.verification.verified)}`);
    out.push(`- Rejected: ${String(report.verification.rejected)}`);
    out.push(`- Unverified: ${String(report.verification.unverified)}`);
    const reasons = report.findings.filter(
      (f) =>
        f.verificationReason !== undefined &&
        toInline(f.verificationReason) !== "",
    );
    if (reasons.length > 0) {
      out.push("");
      for (const f of reasons) {
        out.push(
          `- ${toInline(f.id)}: ${toInline(f.verificationReason as string)}`,
        );
      }
    }
    out.push("");
    out.push("## Summary");
    out.push("");
    const summary = toInline(report.summary);
    out.push(summary === "" ? "(no summary recorded)" : summary);
    out.push("");
    out.push("## Limitations");
    out.push("");
    if (report.limitations.length === 0) {
      out.push("None identified.");
      out.push("");
    } else {
      for (const limitation of report.limitations) {
        const inline = toInline(limitation);
        if (inline !== "") out.push(`- ${inline}`);
      }
      out.push("");
    }
    return out.join("\n");
  }
}
