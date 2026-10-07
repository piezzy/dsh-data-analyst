/**
 * record_finding tool (PRD §16).
 *
 * Records a finding — a claim backed by structured evidence —
 * for an investigation.
 *
 * Invariants enforced by the service layer (PRD §16, AC-04):
 *   - the investigation must exist and be non-terminal
 *   - evidenceIds must be non-empty
 *   - every evidence ID must exist and belong to this investigation
 *   - hypothesisIds (optional) must exist in this investigation
 *   - confidence (optional) must be in [0, 1]; when omitted it is
 *     calculated deterministically (PRD §21)
 *   - new findings start as "unverified" (AC-05)
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type {
  FindingService,
  RecordFindingOptions,
} from "../services/finding-service.js";

export interface RecordFindingToolDeps {
  findingService: FindingService;
}

export function defineRecordFindingTool(deps: RecordFindingToolDeps) {
  return defineTool({
    name: "record_finding",
    description:
      "Record a finding (an analytical claim) for an investigation. " +
      "A finding must reference at least one evidence ID from the same " +
      "investigation. New findings start as unverified — use verify_finding " +
      "to deterministically verify the claim against its evidence before " +
      "presenting it as a conclusion.",

    parameters: {
      investigation_id: {
        type: "string",
        required: true,
        description: "ID of the investigation this finding belongs to.",
      },
      claim: {
        type: "string",
        required: true,
        description:
          "The analytical claim, e.g. 'Revenue declined 18.2% in Q3, driven by a 14.8% drop in average order value.'",
      },
      evidence_ids: {
        type: "array",
        items: { type: "string" },
        required: true,
        description:
          "IDs of the evidence records backing this claim. Must be non-empty; every ID must exist and belong to this investigation.",
      },
      hypothesis_ids: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional IDs of hypotheses this finding supports. Each must exist in this investigation.",
      },
      confidence: {
        type: "number",
        description:
          "Optional confidence in [0, 1]. When omitted, confidence is calculated deterministically from evidence availability and hypothesis support (PRD §21).",
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
      const options: RecordFindingOptions = {};
      if (args.hypothesis_ids !== undefined) {
        options.hypothesisIds = args.hypothesis_ids as string[];
      }
      if (args.confidence !== undefined) {
        options.confidence = args.confidence as number;
      }

      return deps.findingService.recordFinding(
        args.investigation_id,
        args.claim,
        args.evidence_ids as string[],
        options,
      ) as any;
    },
  });
}
