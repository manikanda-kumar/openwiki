import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const chatOpenAiCalls: unknown[] = [];

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn(function ChatOpenAIMock(options: unknown) {
    chatOpenAiCalls.push(options);
    return {};
  }),
}));

vi.mock("../src/connectors/tools.js", () => ({
  createOpenWikiConnectorTools: vi.fn(() => []),
}));

describe("openai-compatible streaming transport opt-in", () => {
  beforeEach(() => {
    chatOpenAiCalls.length = 0;
    delete process.env.OPENWIKI_OPENAI_COMPATIBLE_STREAMING;
    process.env.OPENAI_COMPATIBLE_BASE_URL = "https://example.test/v1";
  });

  // Cleared on the way out too, so the opt-in cannot leak into later test files
  // if worker isolation is ever turned off.
  afterEach(() => {
    delete process.env.OPENWIKI_OPENAI_COMPATIBLE_STREAMING;
    delete process.env.OPENAI_COMPATIBLE_BASE_URL;
  });

  test("configures long non-streaming requests by default", async () => {
    const { createModel } = await import("../src/agent/index.ts");

    createModel("openai-compatible", "local-model", 3);

    const [call] = chatOpenAiCalls as [
      {
        configuration: { fetchOptions: { dispatcher: unknown } };
        timeout: number;
      },
    ];

    expect(call).not.toHaveProperty("streaming");
    expect(call.timeout).toBe(1_800_000);
    expect(call.configuration.fetchOptions.dispatcher).toBeInstanceOf(Object);
  });

  test("forces the streaming transport when opted in", async () => {
    process.env.OPENWIKI_OPENAI_COMPATIBLE_STREAMING = "true";
    const { createModel } = await import("../src/agent/index.ts");

    createModel("openai-compatible", "local-model", 3);

    expect(chatOpenAiCalls[0]).toEqual(
      expect.objectContaining({
        model: "local-model",
        streaming: true,
      }),
    );
  });

  test("ignores an explicit false opt-out", async () => {
    process.env.OPENWIKI_OPENAI_COMPATIBLE_STREAMING = "false";
    const { createModel } = await import("../src/agent/index.ts");

    createModel("openai-compatible", "local-model", 3);

    expect(chatOpenAiCalls[0]).not.toHaveProperty("streaming");
  });

  test("does not affect other providers sharing the ChatOpenAI branch", async () => {
    process.env.OPENWIKI_OPENAI_COMPATIBLE_STREAMING = "true";
    const { createModel } = await import("../src/agent/index.ts");

    createModel("openai", "gpt-5.5", 3);

    expect(chatOpenAiCalls[0]).not.toHaveProperty("streaming");
  });
});
