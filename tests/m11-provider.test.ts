import { describe, it, expect } from "vitest";

import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DeepSeekClient,
} from "../src/loop/providers/deepseek-client.js";

const FAKE_KEY = "sk-test-DO-NOT-LOG-9f8e7d6c5b4a";

type FetchArgs = { url: string; init: RequestInit };

function fakeFetch(
  responder: (args: FetchArgs) => Response | Promise<Response>,
) {
  const calls: FetchArgs[] = [];
  const fn = (async (url: any, init?: any) => {
    const args = { url: String(url), init: (init ?? {}) as RequestInit };
    calls.push(args);
    return responder(args);
  }) as typeof fetch;
  return { fn, calls };
}

const okBody = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function bodyOf(call: FetchArgs): any {
  return JSON.parse(String(call.init.body));
}

function headersOf(call: FetchArgs): Record<string, string> {
  const h = call.init.headers as Record<string, string>;
  return { ...(h ?? {}) };
}

/**
 * M11 — DeepSeek provider adapter. Fake fetch only; no network.
 * Asserts transport correctness and that the key never leaks.
 */
describe("M11 DeepSeekClient", () => {
  describe("request shape", () => {
    it("posts to the DeepSeek chat-completions endpoint", async () => {
      const { fn, calls } = fakeFetch(() => okBody('{"action":"STOP"}'));
      const client = new DeepSeekClient({ apiKey: FAKE_KEY, fetchFn: fn });
      await client.generateText({ system: "s", prompt: "p" });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe(
        `${DEFAULT_DEEPSEEK_BASE_URL}/chat/completions`,
      );
      expect(calls[0]!.init.method).toBe("POST");
    });

    it("sends the Authorization header and model/messages", async () => {
      const { fn, calls } = fakeFetch(() => okBody("{}"));
      const client = new DeepSeekClient({ apiKey: FAKE_KEY, fetchFn: fn });
      await client.generateText({ system: "sys", prompt: "usr" });
      const headers = headersOf(calls[0]!);
      expect(headers["authorization"]).toBe(`Bearer ${FAKE_KEY}`);
      const body = bodyOf(calls[0]!);
      expect(body.model).toBe(DEFAULT_DEEPSEEK_MODEL);
      expect(body.messages).toEqual([
        { role: "system", content: "sys" },
        { role: "user", content: "usr" },
      ]);
    });

    it("sends max_tokens, temperature 0, and json response hint", async () => {
      const { fn, calls } = fakeFetch(() => okBody("{}"));
      const client = new DeepSeekClient({ apiKey: FAKE_KEY, fetchFn: fn });
      await client.generateText({ system: "s", prompt: "p", maxTokens: 300 });
      const body = bodyOf(calls[0]!);
      expect(body.max_tokens).toBe(300);
      expect(body.temperature).toBe(0);
      expect(body.response_format).toEqual({ type: "json_object" });
    });

    it("returns the message content text", async () => {
      const { fn } = fakeFetch(() => okBody('{"action":"TEST_NEXT"}'));
      const client = new DeepSeekClient({ apiKey: FAKE_KEY, fetchFn: fn });
      await expect(
        client.generateText({ system: "s", prompt: "p" }),
      ).resolves.toBe('{"action":"TEST_NEXT"}');
    });

    it("honors custom model and base URL (trailing slash tolerated)", async () => {
      const { fn, calls } = fakeFetch(() => okBody("{}"));
      const client = new DeepSeekClient({
        apiKey: FAKE_KEY,
        baseUrl: "https://proxy.example/v1/",
        model: "custom-model",
        fetchFn: fn,
      });
      await client.generateText({ system: "s", prompt: "p" });
      expect(calls[0]!.url).toBe("https://proxy.example/v1/chat/completions");
      expect(bodyOf(calls[0]!).model).toBe("custom-model");
    });
  });

  describe("constructor validation", () => {
    it("rejects empty API keys without echoing a value", () => {
      for (const bad of ["", "   "]) {
        let message = "";
        try {
          new DeepSeekClient({ apiKey: bad, fetchFn: (async () => {
            throw new Error("must not be called");
          }) as typeof fetch });
        } catch (err) {
          message = String(err);
        }
        expect(message).toContain("DSH_LLM_API_KEY");
      }
    });

    it("rejects non-https and invalid base URLs", () => {
      expect(
        () =>
          new DeepSeekClient({
            apiKey: FAKE_KEY,
            baseUrl: "http://insecure.example",
          }),
      ).toThrowError(/https/);
      expect(
        () =>
          new DeepSeekClient({
            apiKey: FAKE_KEY,
            baseUrl: "not a url",
          }),
      ).toThrowError();
    });
  });

  describe("failure modes reject (policy fallback owns recovery)", () => {
    async function rejectsWith(
      responder: (args: FetchArgs) => Response | Promise<Response>,
    ): Promise<string> {
      const { fn } = fakeFetch(responder);
      const client = new DeepSeekClient({ apiKey: FAKE_KEY, fetchFn: fn });
      try {
        await client.generateText({ system: "s", prompt: "p" });
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
      throw new Error("expected generateText to reject");
    }

    it("non-2xx carries status, not the body", async () => {
      const message = await rejectsWith(
        () =>
          new Response(JSON.stringify({ secret: "body" }), { status: 500 }),
      );
      expect(message).toContain("500");
      expect(message).not.toContain("secret");
    });

    it("malformed JSON rejects", async () => {
      const message = await rejectsWith(() => new Response("{nope", { status: 200 }));
      expect(message).toMatch(/JSON/i);
    });

    it("non-object JSON rejects", async () => {
      await expect(
        (async () =>
          rejectsWith(() => new Response("[1,2]", { status: 200 })))(),
      ).resolves.toMatch(/shape/i);
    });

    it("missing and empty choices reject", async () => {
      await expect(
        rejectsWith(
          () => new Response(JSON.stringify({}), { status: 200 }),
        ),
      ).resolves.toMatch(/choices/i);
      await expect(
        rejectsWith(
          () =>
            new Response(JSON.stringify({ choices: [] }), { status: 200 }),
        ),
      ).resolves.toMatch(/choices/i);
    });

    it("missing message and non-string/empty content reject", async () => {
      await expect(
        rejectsWith(
          () =>
            new Response(JSON.stringify({ choices: [{}] }), { status: 200 }),
        ),
      ).resolves.toMatch(/content/i);
      await expect(
        rejectsWith(() => okBody(42)),
      ).resolves.toMatch(/content/i);
      await expect(
        rejectsWith(() => okBody("   ")),
      ).resolves.toMatch(/content/i);
    });

    it("network failure rejects without the key", async () => {
      const message = await rejectsWith(() => {
        throw new Error("socket hang up");
      });
      expect(message).toContain("socket hang up");
      expect(message).not.toContain(FAKE_KEY);
    });

    it("oversized bodies reject via header hint and via length", async () => {
      const big = "x".repeat(70000);
      await expect(
        rejectsWith(
          () =>
            new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
              status: 200,
              headers: { "content-length": "100000" },
            }),
        ),
      ).resolves.toMatch(/size limit/i);
      await expect(
        rejectsWith(
          () =>
            new Response(
              JSON.stringify({ choices: [{ message: { content: big } }] }),
              { status: 200 },
            ),
        ),
      ).resolves.toMatch(/size limit/i);
    });

    it("abort propagates so the policy race settles", async () => {
      const controller = new AbortController();
      const seen: Array<AbortSignal | null | undefined> = [];
      const { fn } = fakeFetch((args) => {
        seen.push(args.init.signal);
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      });
      const client = new DeepSeekClient({ apiKey: FAKE_KEY, fetchFn: fn });
      await expect(
        client.generateText({ system: "s", prompt: "p", signal: controller.signal }),
      ).rejects.toThrowError("aborted");
      expect(seen[0]).toBe(controller.signal);
    });

    it("no thrown message ever contains the API key", async () => {
      const messages: string[] = [];
      const cases: Array<(args: FetchArgs) => Response | Promise<Response>> = [
        () => new Response("x", { status: 401 }),
        () => new Response("{bad", { status: 200 }),
        () => {
          throw new Error(`wrap ${FAKE_KEY} must not leak`);
        },
      ];
      for (const responder of cases) {
        messages.push(await rejectsWith(responder));
      }
      // Constructor messages reference the env name, never a value.
      try {
        new DeepSeekClient({ apiKey: "" });
      } catch (err) {
        messages.push(String(err));
      }
      for (const message of messages) {
        expect(message).not.toContain(FAKE_KEY);
      }
    });
  });
});
