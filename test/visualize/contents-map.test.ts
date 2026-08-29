import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  escapeHtml,
  exportContentsMap,
  groupSections,
  markdownHref,
} from "../../src/visualize/contents-map.ts";
import type { WikiNode } from "../../src/visualize/graph.ts";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "openwiki-map-"));
  tempDirs.push(dir);
  return dir;
}

function node(id: string, title: string): WikiNode {
  return {
    id,
    title,
    type: "Reference",
    description: "",
    tags: [],
    body: "",
    size: 0,
    links: [],
    backlinks: [],
  };
}

async function writeSampleWiki(wikiRoot: string): Promise<void> {
  await mkdir(path.join(wikiRoot, "architecture"), { recursive: true });
  await writeFile(
    path.join(wikiRoot, "index.md"),
    "---\ntitle: Home\ntype: Section\ndescription: Entry point\n---\n# Files\n\nSee [Runner](architecture/runner.md).\n",
  );
  await writeFile(
    path.join(wikiRoot, "architecture", "runner.md"),
    "---\ntitle: Runner\ntype: Reference\ndescription: How runs execute\ntags: [agent, runtime]\n---\n# Runner\n",
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

test("groups root pages first, then sections alphabetically with index leading", () => {
  const sections = groupSections([
    node("workflows/update", "Update"),
    node("architecture/runner", "Runner"),
    node("architecture/index", "Architecture"),
    node("quickstart", "Quickstart"),
  ]);

  expect(sections.map((section) => section.id)).toEqual([
    "__root",
    "architecture",
    "workflows",
  ]);
  expect(sections[1].title).toBe("Architecture");
  expect(sections[1].pages.map((page) => page.id)).toEqual([
    "architecture/index",
    "architecture/runner",
  ]);
});

test("markdownHref stays relative to the output file", () => {
  const wikiRoot = path.resolve("/wiki");
  expect(
    markdownHref(
      path.join(wikiRoot, "map.html"),
      wikiRoot,
      node("architecture/runner", "Runner"),
    ),
  ).toBe("./architecture/runner.md");
  expect(
    markdownHref(
      path.resolve("/site/map.html"),
      wikiRoot,
      node("quickstart", "Quickstart"),
    ),
  ).toBe("../wiki/quickstart.md");
});

test("escapeHtml neutralizes markup and quotes", () => {
  expect(escapeHtml(`<img src="x" onerror='y'>&`)).toBe(
    "&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;&amp;",
  );
});

test("writes a standalone page linking every markdown file", async () => {
  const root = await makeTempDir();
  const wikiRoot = path.join(root, "openwiki");
  await writeSampleWiki(wikiRoot);

  const result = await exportContentsMap({
    wikiRoot,
    outputFile: path.join(wikiRoot, "map.html"),
  });

  expect(result.graph.nodes).toHaveLength(2);
  const html = await readFile(result.outputFile, "utf8");
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toContain("./architecture/runner.md");
  expect(html).toContain("./index.md");
  expect(html).toContain("How runs execute");
  expect(html).toContain('<span class="tag">runtime</span>');
  // Standalone: styles and script are inlined, nothing is fetched.
  expect(html).not.toContain("http://");
  expect(html).not.toContain("https://");
});

test("creates missing parent directories for --output", async () => {
  const root = await makeTempDir();
  const wikiRoot = path.join(root, "openwiki");
  await writeSampleWiki(wikiRoot);
  const outputFile = path.join(root, "site", "nested", "map.html");

  await exportContentsMap({ wikiRoot, outputFile });

  expect((await readFile(outputFile, "utf8")).length).toBeGreaterThan(0);
});

test("escapes page metadata drawn from the wiki", async () => {
  const root = await makeTempDir();
  const wikiRoot = path.join(root, "openwiki");
  await mkdir(wikiRoot, { recursive: true });
  await writeFile(
    path.join(wikiRoot, "xss.md"),
    '---\ntitle: "<script>alert(1)</script>"\ntype: Reference\n---\n# x\n',
  );

  const result = await exportContentsMap({
    wikiRoot,
    outputFile: path.join(wikiRoot, "map.html"),
  });
  const html = await readFile(result.outputFile, "utf8");

  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
});
