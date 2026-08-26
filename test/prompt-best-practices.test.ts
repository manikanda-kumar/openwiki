import { describe, expect, it } from "vitest";
import {
  createModeInstructions,
  createSystemPrompt,
} from "../src/agent/prompt.js";

describe("code-mode best-practices prompt", () => {
  it("requires best-practices.md in repository system prompt", () => {
    const prompt = createSystemPrompt("init", "repository");

    expect(prompt).toContain("/openwiki/best-practices.md");
    expect(prompt).toContain("used-in-this-codebase");
    expect(prompt).toContain("generally public knowledge");
    expect(prompt).toContain("Inventory tags");
    expect(prompt).toContain("Language & runtime");
    expect(prompt).toContain("Frameworks & libraries (used)");
    expect(prompt).toContain("Shared utilities (internal)");
    expect(prompt).toContain("Watch-outs");
    expect(prompt).toContain("go.mod");
    expect(prompt).toContain("archetype");
  });

  it("skips required best-practices page for local wiki mode", () => {
    const prompt = createSystemPrompt("init", "local-wiki");

    expect(prompt).toContain(
      "Local personal wiki mode does not require a best-practices page",
    );
    expect(prompt).not.toContain(
      "Code mode must maintain /openwiki/best-practices.md",
    );
  });

  it("asks init/update runs to use successive subagent waves instead of stopping at a first pass", () => {
    const prompt = createSystemPrompt("init", "repository");

    expect(prompt).toContain("Default to 3-4 subagents");
    expect(prompt).toContain("successive waves");
    expect(prompt).not.toContain("Default to 1-2 subagents");
    expect(prompt).toContain("do not stop at the first pass");
  });

  it("lets multi-repo inits exceed the single-repo page budget", () => {
    const repoInit = createModeInstructions("init", "repository");

    expect(repoInit).toContain("at most 8 documentation pages");
    expect(repoInit).toContain("Multi-repo");
    expect(repoInit).toContain("one substantial page per sibling");
  });

  it("mentions best-practices creation on repository init only", () => {
    const repoInit = createModeInstructions("init", "repository");
    const localInit = createModeInstructions("init", "local-wiki");

    expect(repoInit).toContain("/openwiki/best-practices.md");
    expect(localInit).not.toContain("/openwiki/best-practices.md");
  });
});
