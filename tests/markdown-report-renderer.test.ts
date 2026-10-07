import { describe, it, expect } from "vitest";

import type { InvestigationReport } from "../src/models/report.js";
import { MarkdownReportRenderer } from "../src/services/markdown-report-renderer.js";

/**
 * M7.2 markdown renderer tests. The renderer is a pure function of
 * an existing InvestigationReport: no services, no analysis, no LLM.
 */
describe("MarkdownReportRenderer (M7.2)", () => {
  const renderer = new MarkdownReportRenderer();

  const jakartaReport: InvestigationReport = {
    investigation: {
      id: "investigation-001",
      goal: "Compare Jakarta vs Surabaya revenue",
      status: "completed",
    },
    hypotheses: [
      {
        id: "H1",
        statement: "Jakarta revenue is higher than Surabaya revenue.",
        status: "rejected",
        rationale:
          "Directional comparison from parsed goal intent (region: Jakarta vs Surabaya)",
      },
    ],
    evidence: [
      {
        id: "evidence-001",
        type: "comparison",
        operation: "compare",
        input: {
          datasetId: "dataset-001",
          groupColumn: "region",
          valueColumn: "revenue",
          func: "mean",
          baseGroup: "Jakarta",
          compareGroup: "Surabaya",
        },
        result: {
          baseGroup: "Jakarta",
          baseValue: 147500.25,
          compareGroup: "Surabaya",
          compareValue: 225000.375,
          absoluteDiff: 77500.125,
          percentageDiff: 52.542368572256656,
        },
      },
    ],
    findings: [
      {
        id: "finding-001",
        claim:
          "Surabaya revenue was 52.5% higher than Jakarta (mean 225000.38 vs 147500.25).",
        evidenceIds: ["evidence-001"],
        hypothesisIds: ["H1"],
        confidence: 0.17,
        verificationStatus: "verified",
        verificationReason:
          "All 1 evidence record(s) were reproduced deterministically and match the recorded results",
      },
    ],
    verification: { findings: 1, verified: 1, rejected: 0, unverified: 0 },
    summary: "Investigation produced 1 finding. 1 finding was verified.",
    limitations: [],
  };

  it("should render a normal completed report", () => {
    const md = renderer.render(jakartaReport);
    expect(md).toContain("# Investigation Report");
    expect(md).toContain("## Goal");
    expect(md).toContain("Compare Jakarta vs Surabaya revenue");
    expect(md).toContain("- Status: completed");
    expect(md).toContain("- Investigation ID: investigation-001");
    expect(md).toContain("### H1 — Rejected");
    expect(md).toContain(
      "Jakarta revenue is higher than Surabaya revenue.",
    );
    expect(md).toContain("- Base group: Jakarta");
    expect(md).toContain("- Base value: 147500.25");
    expect(md).toContain("- Compare group: Surabaya");
    expect(md).toContain("- Compare value: 225000.375");
    expect(md).toContain("- Difference: 77500.125");
    expect(md).toContain("- Percentage difference: 52.542368572256656%");
    expect(md).toContain(
      "### 1. Surabaya revenue was 52.5% higher than Jakarta",
    );
    expect(md).toContain("Confidence: 0.17");
    expect(md).toContain("Verification: Verified");
    expect(md).toContain("Evidence: evidence-001");
    expect(md).toContain("Hypotheses: H1");
    expect(md).toContain("- Findings: 1");
    expect(md).toContain("- Verified: 1");
    expect(md).toContain(
      "Investigation produced 1 finding. 1 finding was verified.",
    );
  });

  it("should render multiple hypotheses, evidence, and findings", () => {
    const md = renderer.render({
      investigation: {
        id: "investigation-002",
        goal: "Analyze revenue by product and region",
        status: "completed",
      },
      hypotheses: [
        { id: "H1", statement: "Mean revenue differs across product.", status: "supported" },
        { id: "H2", statement: "Mean revenue differs across region.", status: "inconclusive" },
      ],
      evidence: [
        {
          id: "evidence-001",
          type: "comparison",
          operation: "aggregate",
          input: { groupBy: "product" },
          result: [
            { product: "Widget A", mean: 147500.25 },
            { product: "Widget B", mean: 85000 },
          ],
        },
        {
          id: "evidence-002",
          type: "statistic",
          operation: "trend",
          input: { timeColumn: "date", valueColumn: "revenue" },
          result: [
            { date: "2024-01-15", value: 150000.5 },
            { date: "2024-02-01", value: 145000 },
          ],
        },
      ],
      findings: [
        {
          id: "finding-001",
          claim: "Widget A revenue exceeds Widget B.",
          evidenceIds: ["evidence-001"],
          hypothesisIds: ["H1"],
          confidence: 0.5,
          verificationStatus: "verified",
        },
        {
          id: "finding-002",
          claim: "Revenue varies over time.",
          evidenceIds: ["evidence-002"],
          confidence: 0.42,
          verificationStatus: "unverified",
        },
      ],
      verification: { findings: 2, verified: 1, rejected: 0, unverified: 1 },
      summary: "Investigation produced 2 findings. 1 finding was verified.",
      limitations: [
        "Finding finding-002 is unverified and should not be treated as a confirmed conclusion.",
      ],
    });
    expect(md).toContain("### H1 — Supported");
    expect(md).toContain("### H2 — Inconclusive");
    expect(md).toContain("### E1 — comparison");
    expect(md).toContain("### E2 — statistic");
    expect(md).toContain("| product | mean |");
    expect(md).toContain("### 1. Widget A revenue exceeds Widget B.");
    expect(md).toContain("### 2. Revenue varies over time.");
    expect(md).toContain("- Findings: 2");
    expect(md).toContain("- Unverified: 1");
    expect(md).toContain("Finding finding-002 is unverified");
  });

  it("should handle empty findings, evidence, and limitations", () => {
    const md = renderer.render({
      investigation: {
        id: "investigation-003",
        goal: "Analyze revenue",
        status: "failed",
      },
      hypotheses: [],
      evidence: [],
      findings: [],
      verification: { findings: 0, verified: 0, rejected: 0, unverified: 0 },
      summary: "Investigation produced no findings.",
      limitations: [],
    });
    expect(md).toContain("No hypotheses recorded.");
    expect(md).toContain("No evidence recorded.");
    expect(md).toContain("No findings recorded.");
    expect(md).toContain("None identified.");
  });

  it("should omit optional rationale and hypothesisIds when missing", () => {
    const md = renderer.render({
      ...jakartaReport,
      hypotheses: [
        {
          id: "H1",
          statement: "Mean revenue differs across region.",
          status: "supported",
        },
      ],
      findings: [
        {
          id: "finding-001",
          claim: "Mean revenue differs.",
          evidenceIds: ["evidence-001"],
          confidence: 0.5,
          verificationStatus: "verified",
        },
      ],
    });
    expect(md).not.toContain("Rationale:");
    expect(md).not.toContain("Hypotheses:");
  });

  it("should keep multiline untrusted text from breaking structure", () => {
    const md = renderer.render({
      ...jakartaReport,
      investigation: {
        id: "investigation-004",
        goal: "Compare X\n## Injected heading\n# Another",
        status: "completed",
      },
      findings: [
        {
          ...jakartaReport.findings[0]!,
          claim: "Line one\n## Fake section\nLine two",
        },
      ],
    });
    const headingLines = md.split("\n").filter((l) => l.startsWith("## "));
    expect(headingLines).toEqual([
      "## Goal",
      "## Investigation",
      "## Hypotheses",
      "## Evidence",
      "## Findings",
      "## Verification",
      "## Summary",
      "## Limitations",
    ]);
    expect(md).toContain("Compare X ## Injected heading # Another");
    expect(md).toContain("Line one ## Fake section Line two");
  });

  it("should produce exactly identical output on repeated renders", () => {
    expect(renderer.render(jakartaReport)).toBe(
      renderer.render(jakartaReport),
    );
  });

  it("should render the claim and summary exactly", () => {
    const md = renderer.render(jakartaReport);
    expect(md).toContain(
      "Surabaya revenue was 52.5% higher than Jakarta (mean 225000.38 vs 147500.25).",
    );
    expect(md).toContain(
      "Investigation produced 1 finding. 1 finding was verified.",
    );
  });
});
