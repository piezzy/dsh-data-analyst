/**
 * M10 Tier 1 LLM client abstraction.
 *
 * Text in, text out. The client owns transport only: it must not parse
 * JSON, execute tools, run analyses, or mutate investigation state. JSON
 * extraction and validation live in `llm-policy.ts`; execution lives in
 * the investigation driver. Stub implementations serve tests; a real
 * provider adapter plugs in here later without touching the loop.
 */
export interface LLMTextRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LLMClient {
  generateText(input: LLMTextRequest): Promise<string>;
}
