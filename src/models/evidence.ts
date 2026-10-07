/**
 * Evidence model for dsh-data-analyst.
 *
 * PRD §15: Every analysis produces evidence. Evidence is the atomic,
 * reproducible record of one deterministic computation — the link between
 * a claim and the data that supports it (PRD §10.3 "No unsupported
 * insight").
 *
 * Example (PRD §15):
 *   {
 *     "id": "evidence-004",
 *     "investigationId": "investigation-001",
 *     "type": "comparison",
 *     "operation": "year_over_year_revenue",
 *     "input": { "period": "Q3", "groupBy": "region" },
 *     "result": { "Jakarta": -31.2, "Bandung": -4.1 },
 *     "createdAt": "2024-..."
 *   }
 */

export type EvidenceType =
  | "query"
  | "calculation"
  | "profile"
  | "statistic"
  | "comparison";

export type Evidence = {
  id: string;
  investigationId: string;
  type: EvidenceType;
  /** Name of the deterministic operation that produced this evidence */
  operation: string;
  /** Input context of the computation (parameters, filters, grouping) */
  input: unknown;
  /** Deterministic result of the computation */
  result: unknown;
  /** ISO 8601 creation timestamp */
  createdAt: string;
};

export const EVIDENCE_TYPES: readonly EvidenceType[] = [
  "query",
  "calculation",
  "profile",
  "statistic",
  "comparison",
];

export function isEvidenceType(value: unknown): value is EvidenceType {
  return (
    typeof value === "string" &&
    (EVIDENCE_TYPES as readonly string[]).includes(value)
  );
}
