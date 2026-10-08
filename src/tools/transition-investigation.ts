/**
 * transition_investigation tool (PRD §19 state machine).
 *
 * Moves an investigation to its next required state:
 *
 *   planning → investigating → verifying → completed
 *   any non-terminal state → failed (partial evidence preserved)
 *
 * Invalid transitions are rejected; a failure reason may be recorded
 * when marking an investigation as failed.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { InvestigationStatus } from "../models/investigation.js";
import type { InvestigationService } from "../services/investigation-service.js";

export interface TransitionInvestigationToolDeps {
  investigationService: InvestigationService;
}

const TRANSITION_STATUSES = [
  "investigating",
  "verifying",
  "completed",
  "failed",
] as const;

export function defineTransitionInvestigationTool(
  deps: TransitionInvestigationToolDeps,
) {
  return defineTool({
    name: "transition_investigation",
    description:
      "Move an investigation to its next state (investigating, verifying, " +
      "completed, or failed). Transitions follow the investigation state " +
      "machine; invalid transitions are rejected. A reason may be recorded " +
      "when marking an investigation as failed.",

    parameters: {
      investigation_id: {
        type: "string",
        required: true,
        description: "ID of the investigation to transition.",
      },
      status: {
        type: "string",
        required: true,
        enum: [...TRANSITION_STATUSES],
        description: "The state to move the investigation to.",
      },
      reason: {
        type: "string",
        description:
          "Failure reason, recorded only when status is 'failed' (optional).",
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
      const status = args.status as InvestigationStatus;
      if (status === "failed") {
        return deps.investigationService.fail(
          args.investigation_id,
          args.reason,
        ) as any;
      }
      return deps.investigationService.transitionTo(
        args.investigation_id,
        status,
      ) as any;
    },
  });
}
