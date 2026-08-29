import { afterEach, describe, expect, test, vi } from "vitest";
import {
  resolveModelId,
  resolveRepositoryModelIds,
} from "../../src/agent/index.ts";
import {
  DEFAULT_OPENWIKI_SPECIALIST_PATH_PREFIXES,
  OPENWIKI_MODEL_ID_ENV_KEY,
  OPENWIKI_PAGE_MODEL_ID_ENV_KEY,
  OPENWIKI_PLANNER_MODEL_ID_ENV_KEY,
  OPENWIKI_SPECIALIST_MODEL_ID_ENV_KEY,
  OPENWIKI_SPECIALIST_PATH_PREFIXES_ENV_KEY,
} from "../../src/config/constants.ts";
import type { OpenWikiRunEvent } from "../../src/agent/types.ts";

const repositoryModelEnvKeys = [
  OPENWIKI_MODEL_ID_ENV_KEY,
  OPENWIKI_PLANNER_MODEL_ID_ENV_KEY,
  OPENWIKI_PAGE_MODEL_ID_ENV_KEY,
  OPENWIKI_SPECIALIST_MODEL_ID_ENV_KEY,
  OPENWIKI_SPECIALIST_PATH_PREFIXES_ENV_KEY,
] as const;
const originalEnv = Object.fromEntries(
  repositoryModelEnvKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of repositoryModelEnvKeys) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("resolveModelId", () => {
  test("uses the provider's first preset when nothing is configured", () => {
    delete process.env[OPENWIKI_MODEL_ID_ENV_KEY];

    expect(resolveModelId({}, "anthropic")).toBe("claude-haiku-4-5");
  });

  test("prefers an explicit option over the env var and the preset", () => {
    process.env[OPENWIKI_MODEL_ID_ENV_KEY] = "claude-opus-4-8";

    expect(resolveModelId({ modelId: "claude-sonnet-5" }, "anthropic")).toBe(
      "claude-sonnet-5",
    );
  });

  test.each(["bedrock", "openai-compatible"] as const)(
    "requires an explicit model ID for %s, which has no presets",
    (provider) => {
      delete process.env[OPENWIKI_MODEL_ID_ENV_KEY];

      expect(() => resolveModelId({}, provider)).toThrow(
        new RegExp(`${OPENWIKI_MODEL_ID_ENV_KEY}.*required`, "u"),
      );
    },
  );

  test.each(["bedrock", "openai-compatible"] as const)(
    "accepts an explicit model ID for %s from the env var",
    (provider) => {
      process.env[OPENWIKI_MODEL_ID_ENV_KEY] = "custom-model-id";

      expect(resolveModelId({}, provider)).toBe("custom-model-id");
    },
  );

  test("rejects an invalid configured model ID", () => {
    expect(() =>
      resolveModelId({ modelId: "http://evil.example" }, "anthropic"),
    ).toThrow(/Invalid model ID/u);
  });
});

describe("resolveRepositoryModelIds", () => {
  test("uses OPENWIKI_MODEL_ID for every unset role", () => {
    process.env[OPENWIKI_MODEL_ID_ENV_KEY] = "fallback-model";
    delete process.env[OPENWIKI_PLANNER_MODEL_ID_ENV_KEY];
    delete process.env[OPENWIKI_PAGE_MODEL_ID_ENV_KEY];
    delete process.env[OPENWIKI_SPECIALIST_MODEL_ID_ENV_KEY];
    process.env[OPENWIKI_SPECIALIST_PATH_PREFIXES_ENV_KEY] = "architecture/";

    expect(resolveRepositoryModelIds({}, "openai-compatible")).toEqual({
      plannerModelId: "fallback-model",
      pageModelId: "fallback-model",
      specialistPathPrefixes: [],
    });
  });

  test("uses the planner override while the page role falls back", () => {
    process.env[OPENWIKI_MODEL_ID_ENV_KEY] = "fallback-model";
    process.env[OPENWIKI_PLANNER_MODEL_ID_ENV_KEY] = "planner-model";
    delete process.env[OPENWIKI_PAGE_MODEL_ID_ENV_KEY];
    delete process.env[OPENWIKI_SPECIALIST_MODEL_ID_ENV_KEY];

    expect(resolveRepositoryModelIds({}, "openai-compatible")).toMatchObject({
      plannerModelId: "planner-model",
      pageModelId: "fallback-model",
    });
  });

  test("resolves independent planner and page overrides", () => {
    process.env[OPENWIKI_MODEL_ID_ENV_KEY] = "fallback-model";
    process.env[OPENWIKI_PLANNER_MODEL_ID_ENV_KEY] = "planner-model";
    process.env[OPENWIKI_PAGE_MODEL_ID_ENV_KEY] = "page-model";
    delete process.env[OPENWIKI_SPECIALIST_MODEL_ID_ENV_KEY];

    expect(resolveRepositoryModelIds({}, "openai-compatible")).toMatchObject({
      plannerModelId: "planner-model",
      pageModelId: "page-model",
    });
  });

  test("enables the default prefixes only when a specialist model is set", () => {
    process.env[OPENWIKI_MODEL_ID_ENV_KEY] = "fallback-model";
    process.env[OPENWIKI_SPECIALIST_MODEL_ID_ENV_KEY] = "specialist-model";
    delete process.env[OPENWIKI_SPECIALIST_PATH_PREFIXES_ENV_KEY];

    expect(resolveRepositoryModelIds({}, "openai-compatible")).toMatchObject({
      specialistModelId: "specialist-model",
      specialistPathPrefixes: [...DEFAULT_OPENWIKI_SPECIALIST_PATH_PREFIXES],
    });
  });

  test("parses custom specialist prefixes in configured order", () => {
    process.env[OPENWIKI_MODEL_ID_ENV_KEY] = "fallback-model";
    process.env[OPENWIKI_SPECIALIST_MODEL_ID_ENV_KEY] = "specialist-model";
    process.env[OPENWIKI_SPECIALIST_PATH_PREFIXES_ENV_KEY] =
      " custom/one,architecture/session-,, custom/two ";

    expect(
      resolveRepositoryModelIds({}, "openai-compatible").specialistPathPrefixes,
    ).toEqual(["custom/one", "architecture/session-", "custom/two"]);
  });

  test("keeps --modelId as the fallback for every role", () => {
    process.env[OPENWIKI_MODEL_ID_ENV_KEY] = "env-model";
    delete process.env[OPENWIKI_PLANNER_MODEL_ID_ENV_KEY];
    delete process.env[OPENWIKI_PAGE_MODEL_ID_ENV_KEY];
    delete process.env[OPENWIKI_SPECIALIST_MODEL_ID_ENV_KEY];

    expect(
      resolveRepositoryModelIds(
        { modelId: "command-model" },
        "openai-compatible",
      ),
    ).toMatchObject({
      plannerModelId: "command-model",
      pageModelId: "command-model",
    });
  });
});

describe("resolveModelId – provider/model mismatch warning", () => {
  test("warns (without failing) when the model belongs to a different provider", () => {
    // A known Anthropic model left configured while the provider is Gemini is a
    // likely misconfiguration. resolveModelId still returns the model (a gateway
    // may serve it) but must surface an actionable warning via onEvent and
    // stderr so a later opaque provider 400 is pre-empted.
    const events: OpenWikiRunEvent[] = [];
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    try {
      const modelId = resolveModelId(
        {
          modelId: "claude-haiku-4-5",
          debug: true,
          onEvent: (event) => events.push(event),
        },
        "gemini",
      );

      // The run is not blocked: the mismatched model is returned as-is.
      expect(modelId).toBe("claude-haiku-4-5");

      const warning = events.find(
        (event): event is Extract<OpenWikiRunEvent, { type: "text" }> =>
          event.type === "text",
      );
      expect(warning?.text).toContain("claude-haiku-4-5");
      expect(warning?.text).toMatch(/not a known/u);

      // The debug breadcrumb records the mismatch classification.
      expect(events.some((event) => event.type === "debug")).toBe(true);
      // The warning is mirrored to stderr so it survives a later failure.
      expect(stderr).toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });

  test("does not warn when the model is valid for the configured provider", () => {
    const events: OpenWikiRunEvent[] = [];
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    try {
      resolveModelId(
        { modelId: "claude-haiku-4-5", onEvent: (event) => events.push(event) },
        "anthropic",
      );

      expect(events).toHaveLength(0);
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });
});
