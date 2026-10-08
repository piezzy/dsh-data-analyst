/**
 * add_hypothesis tool (PRD §14).
 *
 * Proposes one testable hypothesis for an investigation. The hypothesis
 * starts in "proposed" status; the agent (or run_investigation) moves it
 * through testing via deterministic analysis. IDs are per-investigation
 * and sequential ("H1", "H2", ...).
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { InvestigationService } from "../services/investigation-service.js";

export interface AddHypothesisToolDeps {
  investigationService: InvestigationService;
}

export function defineAddHypothesisTool(deps: AddHypothesisToolDeps) {
  return defineTool({
    name: "add_hypothesis",
    description:
      "Propose a testable hypothesis for an investigation. The hypothesis " +
      "is recorded before any analysis runs and starts in 'proposed' status. " +
      "Test it with deterministic analyses and record the outcomes with " +
      "record_evidence.",

    parameters: {
      investigation_id: {
        type: "string",
        required: true,
        description: "ID of the investigation this hypothesis belongs to.",
      },
      statement: {
        type: "string",
        required: true,
        description:
          "The testable statement, e.g. 'North revenue is higher than South revenue.'",
      },
      rationale: {
        type: "string",
        description:
          "Why this hypothesis is worth testing (optional).",
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
      return deps.investigationService.addHypothesis(
        args.investigation_id,
        args.statement,
        args.rationale,
      ) as any;
    },
  });
}
