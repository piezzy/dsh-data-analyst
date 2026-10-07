/**
 * get_investigation tool (PRD §11).
 *
 * Retrieves an investigation by ID, including its hypotheses, current
 * status, and — optionally — the full evidence records linked to it.
 * This is the primary read-back tool for the investigation workflow.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { EvidenceService } from "../services/evidence-service.js";
import type { InvestigationService } from "../services/investigation-service.js";

export interface GetInvestigationToolDeps {
  investigationService: InvestigationService;
  evidenceService: EvidenceService;
}

export function defineGetInvestigationTool(deps: GetInvestigationToolDeps) {
  return defineTool({
    name: "get_investigation",
    description:
      "Retrieve an investigation by ID, including its goal, status, " +
      "hypotheses, and evidence links. Set include_evidence to true to " +
      "attach the full evidence records (operation, input, result) to the response.",

    parameters: {
      investigation_id: {
        type: "string",
        required: true,
        description: "ID of the investigation to retrieve.",
      },
      include_evidence: {
        type: "boolean",
        description:
          "When true, attach the full evidence records to the response. " +
          "Defaults to false (only evidence IDs are included).",
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
      const investigation = deps.investigationService.getInvestigation(
        args.investigation_id,
      );

      if (args.include_evidence) {
        const evidence = deps.evidenceService.getEvidenceForInvestigation(
          args.investigation_id,
        );
        return { ...investigation, evidence } as any;
      }

      return investigation as any;
    },
  });
}
