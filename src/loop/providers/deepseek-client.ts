/**
 * M11 DeepSeek provider adapter.
 *
 * Implements the provider-agnostic {@link LLMClient} over the
 * OpenAI-compatible DeepSeek chat-completions endpoint using native fetch
 * (no SDK, no new dependency). Transport only: it returns raw model text
 * and rejects on any failure. JSON extraction, Tier 1 validation, and
 * fallback live in `llm-policy.ts` and the investigation driver.
 *
 * Security:
 * - The API key arrives via constructor (composition root reads env).
 * - The key is sent only in the Authorization header and never appears
 *   in errors, logs, reports, evidence, or prompts.
 * - Response bodies are never included in errors.
 */

import type { LLMClient, LLMTextRequest } from "../llm-client.js";

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

/** Reject bodies larger than this before JSON parsing. */
export const MAX_RESPONSE_BODY_CHARS = 65536;

export interface DeepSeekClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof fetch;
}

function readBodyLengthHint(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export class DeepSeekClient implements LLMClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: DeepSeekClientOptions) {
    const apiKey = options.apiKey?.trim() ?? "";
    if (apiKey === "") {
      throw new Error(
        "DeepSeekClient requires a non-empty apiKey " +
          "(provide DSH_LLM_API_KEY at the composition root)",
      );
    }
    const baseUrl = (options.baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL).replace(
      /\/+$/,
      "",
    );
    let protocol = "";
    try {
      protocol = new URL(baseUrl).protocol;
    } catch {
      throw new Error(
        `DeepSeekClient baseUrl is not a valid URL: ${baseUrl}`,
      );
    }
    if (protocol !== "https:") {
      throw new Error(
        `DeepSeekClient baseUrl must use https: ${baseUrl}`,
      );
    }
    const model = options.model?.trim() ?? "";
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model === "" ? DEFAULT_DEEPSEEK_MODEL : model;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async generateText(input: LLMTextRequest): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.prompt },
          ],
          max_tokens: input.maxTokens,
          temperature: 0,
          response_format: { type: "json_object" },
        }),
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      throw new Error(
        this.redact(
          `DeepSeek request failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }

    if (!response.ok) {
      throw new Error(`DeepSeek request failed: HTTP ${response.status}`);
    }

    const lengthHint = readBodyLengthHint(response.headers);
    if (lengthHint !== null && lengthHint > MAX_RESPONSE_BODY_CHARS) {
      throw new Error("DeepSeek response exceeded size limit");
    }

    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      throw new Error(
        `DeepSeek response unreadable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (text.length > MAX_RESPONSE_BODY_CHARS) {
      throw new Error("DeepSeek response exceeded size limit");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("DeepSeek response was not valid JSON");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("DeepSeek response had an unexpected shape");
    }
    const choices = (parsed as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error("DeepSeek response contained no choices");
    }
    const message = (choices[0] as { message?: unknown }).message as
      | { content?: unknown }
      | undefined;
    const content = message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("DeepSeek response contained no text content");
    }
    return content;
  }

  /**
   * Defense in depth: transport errors echo URLs and library text. The
   * key travels header-only and should never appear, but if it ever
   * does, it must not reach an error message.
   */
  private redact(message: string): string {
    return message.split(this.apiKey).join("[redacted]");
  }
}
