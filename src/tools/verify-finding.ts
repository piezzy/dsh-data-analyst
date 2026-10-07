/**
 * verify_finding tool (PRD §17).
 *
 * Verifies a finding by deterministically re-executing its
 * evidence against the dataset through the analysis engine —
 * never by asking the LLM whether a numerical result is correct.
 *
 * The tool returns a structured verification result that
 * distinguishes: evidence existence, structural validity,
 * reproducibility, and whether recomputed results match the
 * recorded results. The finding's verificationStatus is
 * updated to "verified", "rejected", or remains "unverified".
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { VerificationService } from "../services/verification-service.js";

export interface VerifyFindingToolDeps {
  verificationService: VerificationService;
}

export function defineVerifyFindingTool(deps: VerifyFindingToolDeps) {
  return defineTool({
    name: "verify_finding",
    description:
      "Verify a finding by deterministically re-executing its evidence " +
      "against the dataset. Each referenced evidence record is re-run " +
      "through the analysis engine and the recomputed result is compared " +
      "with the recorded result. The finding is marked verified only when " +
      "all evidence reproduces and matches; contradicted evidence rejects " +
      "the finding; evidence that cannot be re-executed leaves the finding " +
      "unverified. Never trust a finding that has not been verified.",

    parameters: {
      finding_id: {
        type: "string",
        required: true,
        description: "ID of the finding to verify.",
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
      return (await deps.verificationService.verifyFinding(
        args.finding_id,
      )) as any;
    },
  });
}
