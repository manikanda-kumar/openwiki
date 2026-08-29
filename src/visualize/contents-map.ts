/**
 * The `openwiki map` renderer: one standalone HTML page that acts as the table of
 * contents for a generated wiki. Unlike the visualizer, the output is a single file
 * with no sidecar assets and no CDN dependencies, so it can be committed next to the
 * markdown it links to and opened straight from disk or a git host.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildGraph, type WikiGraph, type WikiNode } from "./graph.js";

/** Inputs for writing the contents map. */
export interface ContentsMapExportOptions {
  /** Absolute path to the generated wiki that supplies the pages. */
  wikiRoot: string;

  /** Absolute path of the HTML file to write. */
  outputFile: string;
}

/** Summary of one contents-map export. */
export interface ContentsMapExportResult {
  /** Absolute path of the file that was written. */
  outputFile: string;

  /** Graph the page was rendered from. */
  graph: WikiGraph;
}

/** One top-level wiki area (a directory under the wiki root, or the root itself). */
interface MapSection {
  /** Stable anchor/filter id, e.g. "architecture" or "__root". */
  id: string;

  /** Human-readable heading. */
  title: string;

  /** Pages in the section, index page first, then alphabetical by title. */
  pages: WikiNode[];
}

/** Section id used for pages that sit directly in the wiki root. */
const ROOT_SECTION_ID = "__root";

/** Escape a value for interpolation into HTML text or a quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Turn a directory name into a heading ("best-practices" -> "Best practices"). */
function humanize(name: string): string {
  const spaced = name.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Estimated reading time in minutes, floored at one. */
function readingMinutes(node: WikiNode): number {
  return Math.max(1, Math.round(node.body.split(/\s+/).length / 200));
}

/**
 * Group pages by their top-level directory. Root-level pages come first under
 * "Overview"; the remaining sections are alphabetical, and inside each section the
 * index page leads, followed by the other pages by title.
 */
export function groupSections(nodes: WikiNode[]): MapSection[] {
  const bySection = new Map<string, WikiNode[]>();
  for (const node of nodes) {
    const segments = node.id.split("/");
    const key = segments.length > 1 ? segments[0] : ROOT_SECTION_ID;
    const bucket = bySection.get(key);
    if (bucket) {
      bucket.push(node);
    } else {
      bySection.set(key, [node]);
    }
  }

  const keys = [...bySection.keys()].sort((a, b) => {
    if (a === ROOT_SECTION_ID) return -1;
    if (b === ROOT_SECTION_ID) return 1;
    return a.localeCompare(b);
  });

  return keys.map((key) => ({
    id: key,
    title: key === ROOT_SECTION_ID ? "Overview" : humanize(key),
    pages: (bySection.get(key) ?? []).sort((a, b) => {
      const aIndex = a.id.endsWith("index") ? 0 : 1;
      const bIndex = b.id.endsWith("index") ? 0 : 1;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.title.localeCompare(b.title);
    }),
  }));
}

/**
 * Relative href from the HTML file to a page's markdown source, in POSIX form so the
 * link works in a browser and on a git host regardless of the platform it was built on.
 */
export function markdownHref(
  outputFile: string,
  wikiRoot: string,
  node: WikiNode,
): string {
  const target = path.resolve(wikiRoot, `${node.id}.md`);
  const relative = path.relative(path.dirname(outputFile), target);
  const posix = relative.split(path.sep).join("/");
  return posix.startsWith(".") ? posix : `./${posix}`;
}

/** Inline stylesheet: light by default, with a dark variant for `prefers-color-scheme`. */
const STYLES = /* css */ `
:root {
  --bg: #f7f9fc;
  --panel: #ffffff;
  --edge: #dfe6f0;
  --text: #3f5164;
  --heading: #101828;
  --muted: #6b7f96;
  --accent: #1a6fb5;
  --accent-soft: #e8f2fb;
  --shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0a1020;
    --panel: #101a2e;
    --edge: #1e2c47;
    --text: #c3d4e6;
    --heading: #f2f7fd;
    --muted: #7d93ac;
    --accent: #7fc8ff;
    --accent-soft: rgba(127, 200, 255, 0.12);
    --shadow: none;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header {
  border-bottom: 1px solid var(--edge);
  background: var(--panel);
  padding: 28px 32px 20px;
}
h1 { color: var(--heading); font-size: 22px; margin: 0 0 6px; letter-spacing: -0.01em; }
.subtitle { color: var(--muted); font-size: 13px; margin: 0 0 18px; }
.stats { display: flex; flex-wrap: wrap; gap: 22px; margin-bottom: 18px; }
.stat-value { color: var(--heading); font-size: 20px; font-weight: 600; }
.stat-label { color: var(--muted); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
#search {
  width: 100%;
  max-width: 460px;
  padding: 9px 12px;
  border: 1px solid var(--edge);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
}
#search:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.layout { display: flex; align-items: flex-start; gap: 32px; padding: 28px 32px 64px; }
nav {
  position: sticky;
  top: 24px;
  flex: 0 0 208px;
  font-size: 13px;
}
nav ol { list-style: none; margin: 0; padding: 0; }
nav li { margin-bottom: 2px; }
nav a { display: block; padding: 5px 10px; border-radius: 6px; color: var(--text); }
nav a:hover { background: var(--accent-soft); text-decoration: none; }
nav .count { color: var(--muted); float: right; }
main { flex: 1 1 auto; min-width: 0; }
section { margin-bottom: 36px; }
h2 {
  color: var(--heading);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin: 0 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--edge);
}
.cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); }
article {
  background: var(--panel);
  border: 1px solid var(--edge);
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow: var(--shadow);
}
article h3 { font-size: 15px; margin: 0 0 6px; }
article h3 a { color: var(--heading); }
.desc { margin: 0 0 10px; font-size: 13px; color: var(--text); }
.meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; color: var(--muted); }
.badge {
  border: 1px solid var(--edge);
  border-radius: 999px;
  padding: 2px 8px;
  color: var(--accent);
  background: var(--accent-soft);
}
.tag { border-radius: 999px; padding: 2px 8px; background: var(--bg); border: 1px solid var(--edge); }
.path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--muted); }
.related { margin: 10px 0 0; font-size: 12px; color: var(--muted); }
.related a { margin-right: 8px; white-space: nowrap; }
.empty { color: var(--muted); font-size: 13px; }
[hidden] { display: none !important; }
footer { border-top: 1px solid var(--edge); color: var(--muted); font-size: 12px; padding: 16px 32px; }
@media (max-width: 760px) {
  .layout { display: block; padding: 20px 18px 48px; }
  nav { position: static; margin-bottom: 24px; }
}
`;

/** Inline search filter: hides cards and whole sections that do not match the query. */
const SCRIPT = /* js */ `
(function () {
  var input = document.getElementById("search");
  var cards = Array.prototype.slice.call(document.querySelectorAll("article[data-haystack]"));
  var sections = Array.prototype.slice.call(document.querySelectorAll("section[data-section]"));
  var navLinks = Array.prototype.slice.call(document.querySelectorAll("nav a[data-section]"));
  var empty = document.getElementById("no-results");
  input.addEventListener("input", function () {
    var query = input.value.trim().toLowerCase();
    cards.forEach(function (card) {
      card.hidden = query !== "" && card.dataset.haystack.indexOf(query) === -1;
    });
    var visible = 0;
    sections.forEach(function (section) {
      var shown = section.querySelectorAll("article:not([hidden])").length;
      section.hidden = shown === 0;
      visible += shown;
      navLinks.forEach(function (link) {
        if (link.dataset.section === section.dataset.section) link.hidden = shown === 0;
      });
    });
    empty.hidden = visible !== 0;
  });
})();
`;

/** Render one page card. */
function renderCard(
  node: WikiNode,
  href: string,
  titles: Map<string, string>,
): string {
  const haystack = escapeHtml(
    [node.title, node.description, node.type, node.id, ...node.tags]
      .join(" ")
      .toLowerCase(),
  );
  const tags = node.tags
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");
  const description = node.description
    ? `<p class="desc">${escapeHtml(node.description)}</p>`
    : "";
  const related = node.links
    .map((id) => {
      const title = titles.get(id) ?? id;
      return `<a href="#page-${escapeHtml(id)}">${escapeHtml(title)}</a>`;
    })
    .join("");
  const relatedBlock = related
    ? `<p class="related">Links to ${related}</p>`
    : "";
  return `<article id="page-${escapeHtml(node.id)}" data-haystack="${haystack}">
<h3><a href="${escapeHtml(href)}">${escapeHtml(node.title)}</a></h3>
${description}<div class="meta"><span class="badge">${escapeHtml(node.type)}</span>${tags}<span class="path">${escapeHtml(node.id)}.md</span><span>${readingMinutes(node)} min</span><span>${node.backlinks.length} backlink${node.backlinks.length === 1 ? "" : "s"}</span></div>
${relatedBlock}</article>`;
}

/**
 * Render the contents map for an already-built graph.
 *
 * @param graph - Pages and links to render.
 * @param outputFile - Absolute path the HTML will be written to; sets link depth.
 * @param wikiRoot - Absolute wiki root the markdown links resolve against.
 * @returns Complete standalone HTML document.
 */
export function renderContentsMap(
  graph: WikiGraph,
  outputFile: string,
  wikiRoot: string,
): string {
  const sections = groupSections(graph.nodes);
  const titles = new Map(graph.nodes.map((node) => [node.id, node.title]));
  const generated = graph.generatedAt.slice(0, 10);
  const nav = sections
    .map(
      (section) =>
        `<li><a href="#section-${escapeHtml(section.id)}" data-section="${escapeHtml(section.id)}">${escapeHtml(section.title)}<span class="count">${section.pages.length}</span></a></li>`,
    )
    .join("\n");
  const body = sections
    .map(
      (
        section,
      ) => `<section id="section-${escapeHtml(section.id)}" data-section="${escapeHtml(section.id)}">
<h2>${escapeHtml(section.title)}</h2>
<div class="cards">
${section.pages.map((node) => renderCard(node, markdownHref(outputFile, wikiRoot, node), titles)).join("\n")}
</div>
</section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(graph.root)} wiki map</title>
<style>${STYLES}</style>
</head>
<body>
<header>
<h1>${escapeHtml(graph.root)} &middot; wiki map</h1>
<p class="subtitle">Every page in this OpenWiki, grouped by area. Titles link to the markdown source.</p>
<div class="stats">
<div><div class="stat-value">${graph.nodes.length}</div><div class="stat-label">Pages</div></div>
<div><div class="stat-value">${sections.length}</div><div class="stat-label">Sections</div></div>
<div><div class="stat-value">${graph.edges.length}</div><div class="stat-label">Links</div></div>
<div><div class="stat-value">${graph.types.length}</div><div class="stat-label">Page types</div></div>
<div><div class="stat-value">${generated}</div><div class="stat-label">Generated</div></div>
</div>
<input id="search" type="search" placeholder="Filter pages by title, tag, or description" autocomplete="off" />
</header>
<div class="layout">
<nav aria-label="Sections"><ol>
${nav}
</ol></nav>
<main>
${body}
<p id="no-results" class="empty" hidden>No pages match that filter.</p>
</main>
</div>
<footer>Generated by <code>openwiki map</code> from ${escapeHtml(graph.root)} on ${escapeHtml(generated)}.</footer>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/**
 * Build the graph for a wiki and write its contents map to disk.
 */
export async function exportContentsMap(
  options: ContentsMapExportOptions,
): Promise<ContentsMapExportResult> {
  const graph = await buildGraph(options.wikiRoot);
  const html = renderContentsMap(graph, options.outputFile, options.wikiRoot);
  await mkdir(path.dirname(options.outputFile), { recursive: true });
  await writeFile(options.outputFile, html, "utf8");
  return { outputFile: options.outputFile, graph };
}
