/**
 * record_evidence tool (PRD §15).
 *
 * Records one piece of evidence for an investigation. Evidence is the
 * reproducible output of a deterministic computation — the agent runs
 * an analysis (profiling, aggregation, comparison, trend) and records
 * the operation, its input context, and its result here.
 *
 * Every finding must reference at least one evidence record
 * (PRD §16 invariant, AC-04).
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { EvidenceType } from "../models/evidence.js";
import { EVIDENCE_TYPES } from "../models/evidence.js";
import type { EvidenceService } from "../services/evidence-service.js";
import type { InvestigationService } from "../services/investigation-service.js";

export interface RecordEvidenceToolDeps {
  investigationService: InvestigationService;
  evidenceService: EvidenceService;
}

export function defineRecordEvidenceTool(deps: RecordEvidenceToolDeps) {
  return defineTool({
    name: "record_evidence",
    description:
      "Record a piece of evidence for an investigation. Evidence is the " +
      "reproducible output of a deterministic computation (query, calculation, " +
      "profile, statistic, comparison, aggregate, or trend). Record the operation " +
      "name, the input context, and the result. The aggregate, compare, and trend " +
      "operations can be deterministically re-executed during verification; " +
      "every finding must reference evidence.",

    parameters: {
      investigation_id: {
        type: "string",
        required: true,
        description: "ID of the investigation this evidence belongs to.",
      },
      type: {
        type: "string",
        required: true,
        enum: EVIDENCE_TYPES,
        description: "Kind of evidence being recorded.",
      },
      operation: {
        type: "string",
        required: true,
        description:
          "Name of the operation that produced this evidence, e.g. 'revenue_by_region' or 'aov_trend'.",
      },
      input: {
        type: "json",
        description:
          "Input context of the computation: parameters, filters, grouping, period.",
      },
      result: {
        type: "json",
        description: "Deterministic result of the computation.",
      },
    },

    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [
        {
          type: "text",
          text: JSON.stringify(value, null, 2),
        },
      ],
    },

    async execute(args) {
      return deps.evidenceService.recordEvidence(
        args.investigation_id,
        args.type as EvidenceType,
        args.operation,
        args.input,
        args.result,
      ) as any;
    },
  });
}
