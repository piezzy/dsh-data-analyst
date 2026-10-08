/**
 * start_investigation tool (PRD §13).
 *
 * Creates a new investigation for a loaded dataset.
 *
 * Input:
 *   { "dataset_id": "dataset-001", "goal": "Why did revenue decline in Q3?" }
 *
 * Output:
 *   { "investigationId": "investigation-001", "goal": "...", "status": "planning", ... }
 *
 * The dataset must already be loaded via inspect_dataset — this tool
 * does not load files itself.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { DatasetService } from "../services/dataset-service.js";
import type { InvestigationService } from "../services/investigation-service.js";
import { DatasetNotFoundError } from "../utils/errors.js";

export interface StartInvestigationToolDeps {
  datasetService: DatasetService;
  investigationService: InvestigationService;
}

export function defineStartInvestigationTool(deps: StartInvestigationToolDeps) {
  return defineTool({
    name: "start_investigation",
    description:
      "Create a new investigation for a loaded dataset. The investigation " +
      "tracks hypotheses, evidence, and findings for an analytical goal. " +
      "The dataset must already be loaded via inspect_dataset. " +
      "After creating an investigation, propose hypotheses with " +
      "add_hypothesis and record results with record_evidence.",

    parameters: {
      dataset_id: {
        type: "string",
        required: true,
        description:
          "ID of the loaded dataset to investigate (the dataset_id returned by inspect_dataset).",
      },
      goal: {
        type: "string",
        required: true,
        description:
          "Analytical goal for the investigation, e.g. 'Why did revenue decline in Q3?'",
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
      if (!deps.datasetService.hasDataset(args.dataset_id)) {
        throw new DatasetNotFoundError(args.dataset_id);
      }

      return deps.investigationService.createInvestigation(
        args.dataset_id,
        args.goal,
      );
    },
  });
}
