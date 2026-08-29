import { describe, expect, test } from "vitest";
import { parseCommand } from "../../src/cli/commands.ts";

describe("parseCommand map", () => {
  test("defaults to the openwiki dir and no explicit output", () => {
    expect(parseCommand(["map"])).toEqual({
      kind: "map",
      exitCode: 0,
      wikiDir: "openwiki",
      outputFile: null,
    });
  });

  test("accepts a positional dir and --output", () => {
    expect(
      parseCommand(["map", "docs/wiki", "--output", "docs/map.html"]),
    ).toEqual({
      kind: "map",
      exitCode: 0,
      wikiDir: "docs/wiki",
      outputFile: "docs/map.html",
    });
  });

  test("supports --output=FILE form", () => {
    const command = parseCommand(["map", "--output=site/index.html"]);
    expect(command.kind === "map" && command.outputFile).toBe(
      "site/index.html",
    );
  });

  test("rejects --output without a value", () => {
    expect(parseCommand(["map", "--output"])).toEqual({
      kind: "error",
      exitCode: 1,
      message: "--output requires a file path.",
    });
  });

  test("rejects unknown options", () => {
    expect(parseCommand(["map", "--port", "4321"])).toEqual({
      kind: "error",
      exitCode: 1,
      message: "Unknown option for map: --port",
    });
  });

  test("rejects a second positional argument", () => {
    expect(parseCommand(["map", "a", "b"])).toEqual({
      kind: "error",
      exitCode: 1,
      message: "Unknown option for map: b",
    });
  });
});
