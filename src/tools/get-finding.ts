/**
 * get_finding tool (PRD §11, §16).
 *
 * Retrieves a finding by ID — its claim, evidence and hypothesis
 * references, confidence, and verification status. Optionally
 * attaches the latest structured verification result.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { FindingService } from "../services/finding-service.js";
import type { VerificationService } from "../services/verification-service.js";

export interface GetFindingToolDeps {
  findingService: FindingService;
  verificationService: VerificationService;
}

export function defineGetFindingTool(deps: GetFindingToolDeps) {
  return defineTool({
    name: "get_finding",
    description:
      "Retrieve a finding by ID, including its claim, evidence and " +
      "hypothesis references, confidence, and verification status. " +
      "Set include_verification to true to attach the latest structured " +
      "verification result (per-evidence checks, recomputed results, " +
      "and match outcomes).",

    parameters: {
      finding_id: {
        type: "string",
        required: true,
        description: "ID of the finding to retrieve.",
      },
      include_verification: {
        type: "boolean",
        description:
          "When true, attach the latest verification result to the response. " +
          "Defaults to false.",
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
      const finding = deps.findingService.getFinding(args.finding_id);

      if (args.include_verification) {
        const verification =
          deps.verificationService.getVerificationResult(
            args.finding_id,
          );
        return { ...finding, verification } as any;
      }

      return finding as any;
    },
  });
}
