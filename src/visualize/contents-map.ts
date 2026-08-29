/**
 * The `openwiki map` renderer: one standalone HTML page that acts as the table of
 * contents for a generated wiki. Unlike the visualizer, the output is a single file
 * with no sidecar assets and no CDN dependencies, so it can be committed next to the
 * markdown it links to and opened straight from disk or a git host.
 *
 * It borrows the visualizer's design language - the same LangChain palette, the same
 * type colors from `colorsForTypes`, the same control shapes - but leads in light,
 * because this page is read in a browser tab beside the repository rather than in the
 * visualizer's focused dark canvas.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { colorsForTypes } from "./client-lib.js";
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

/**
 * Inline stylesheet. The palette is the visualizer's, with light as the default
 * surface and the dark variant applied by preference or by the header toggle.
 */
const STYLES = /* css */ `
:root {
  color-scheme: light dark;
  --bg: #f4f9fd;
  --panel: #fbfdff;
  --raised: #ffffff;
  --edge: #d8e7f5;
  --edge-soft: #e8f1fa;
  --text: #3d5166;
  --heading: #0b1220;
  --muted: #5b7086;
  --accent: #1a6fb5;
  --accent-hover: #14568c;
  --accent-soft: #e5f4ff;
  --ring: rgba(26, 111, 181, 0.35);
  --shadow: 0 1px 2px rgba(11, 18, 32, 0.06);
}
:root[data-theme="dark"] {
  --bg: #030710;
  --panel: #0b1120;
  --raised: #101a2e;
  --edge: #1a2740;
  --edge-soft: #131f36;
  --text: #c8ddf0;
  --heading: #f2f7fd;
  --muted: #6b8299;
  --accent: #7fc8ff;
  --accent-hover: #99d4ff;
  --accent-soft: rgba(127, 200, 255, 0.12);
  --ring: rgba(127, 200, 255, 0.45);
  --shadow: none;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #030710;
    --panel: #0b1120;
    --raised: #101a2e;
    --edge: #1a2740;
    --edge-soft: #131f36;
    --text: #c8ddf0;
    --heading: #f2f7fd;
    --muted: #6b8299;
    --accent: #7fc8ff;
    --accent-hover: #99d4ff;
    --accent-soft: rgba(127, 200, 255, 0.12);
    --ring: rgba(127, 200, 255, 0.45);
    --shadow: none;
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 88px; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "Lausanne", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); text-decoration: underline; }
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 4px; }
.skip {
  position: absolute;
  left: -9999px;
  top: 8px;
  padding: 8px 14px;
  background: var(--raised);
  border: 1px solid var(--edge);
  border-radius: 8px;
  z-index: 20;
}
.skip:focus { left: 16px; }

/* Topbar: the visualizer's control strip, one line, sticky. */
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 13px 28px;
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--edge);
}
.brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.brand .mark {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  white-space: nowrap;
}
.brand .divider { width: 1px; height: 22px; background: var(--edge); flex: 0 0 auto; }
.brand .name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--heading);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.brand .name small {
  display: block;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--muted);
}
.spacer { flex: 1 1 auto; }
.controls { display: flex; align-items: center; gap: 8px; }
input.search, select.filter {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--edge);
  border-radius: 8px;
  padding: 8px 12px;
  outline: none;
  transition: border-color 0.15s ease;
}
input.search { width: 248px; }
select.filter { max-width: 190px; }
input.search:hover, select.filter:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--edge)); }
input.search:focus, select.filter:focus { border-color: var(--accent); }
input.search::placeholder { color: var(--muted); }
.kbd {
  font: inherit;
  font-size: 11px;
  color: var(--muted);
  border: 1px solid var(--edge);
  border-bottom-width: 2px;
  border-radius: 5px;
  padding: 1px 5px;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid var(--edge);
  background: var(--bg);
  color: var(--text);
  transition: border-color 0.15s ease, color 0.15s ease;
}
.icon-btn:hover { border-color: var(--accent); color: var(--accent); }
.icon-btn svg { width: 17px; height: 17px; }
:root[data-theme="dark"] .icon-sun, :root:not([data-theme="light"]) .icon-sun { display: none; }
:root[data-theme="dark"] .icon-moon, :root:not([data-theme="light"]) .icon-moon { display: block; }
:root:not([data-theme="dark"]) .icon-sun { display: block; }
:root:not([data-theme="dark"]) .icon-moon { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .icon-sun { display: none; }
  :root:not([data-theme="light"]) .icon-moon { display: block; }
}

/* Header line: the wiki in one sentence, not a wall of stat tiles. */
.intro {
  padding: 22px 28px 18px;
  border-bottom: 1px solid var(--edge);
  background: var(--panel);
}
.intro h1 {
  margin: 0 0 5px;
  font-size: 19px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--muted);
}
.intro h1 strong { color: var(--heading); font-weight: 700; }
.intro p { margin: 0; font-size: 13px; color: var(--muted); max-width: 68ch; }
.intro strong { color: var(--text); font-weight: 600; }

.layout { display: flex; align-items: flex-start; gap: 40px; padding: 28px 28px 72px; }

/* Section index, mirroring the visualizer's left rail. */
nav.rail { position: sticky; top: 74px; flex: 0 0 216px; }
.rail-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 2px 10px 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}
.rail-head .rail-count { letter-spacing: 0; font-weight: 500; }
nav.rail ol { list-style: none; margin: 0; padding: 0; }
nav.rail a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 7px;
  font-size: 13px;
  color: var(--text);
  transition: background 0.15s ease, color 0.15s ease;
}
nav.rail a:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); text-decoration: none; }
nav.rail a[aria-current="true"] {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--heading);
  font-weight: 600;
}
nav.rail .n { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }

main { flex: 1 1 auto; min-width: 0; }
section { margin-bottom: 40px; }
section:last-of-type { margin-bottom: 8px; }
.section-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 4px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--edge);
}
.section-head h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--heading);
}
.section-head .n { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }

ul.pages { list-style: none; margin: 0; padding: 0; }
li.page {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 24px;
  padding: 11px 12px 12px 14px;
  margin: 0 -12px 0 -14px;
  border-radius: 10px;
  border-bottom: 1px solid var(--edge-soft);
  transition: background 0.15s ease;
}
li.page:hover { background: var(--raised); box-shadow: var(--shadow); }
li.page:last-child { border-bottom: none; }
.page-title {
  grid-column: 1;
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 15px;
  font-weight: 600;
  color: var(--heading);
  letter-spacing: -0.005em;
}
.page-title a { color: inherit; }
.page-title a:hover { color: var(--accent); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
.page-kind {
  grid-column: 2;
  grid-row: 1;
  align-self: center;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  white-space: nowrap;
}
.page-desc {
  grid-column: 1;
  margin: 4px 0 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--text);
  max-width: 74ch;
  text-wrap: pretty;
}
.page-meta {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  margin-top: 7px;
  font-size: 11.5px;
  color: var(--muted);
}
.page-meta a { color: var(--muted); }
.page-meta a:hover { color: var(--accent); }
.page-meta .sep { opacity: 0.5; }
.page-meta .path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag.more { color: var(--muted); background: var(--edge-soft); }
.page-leads {
  grid-column: 1 / -1;
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--muted);
  max-width: 78ch;
}
.page-leads a { color: var(--muted); }
.page-leads a:hover { color: var(--accent); }
.page-leads .arrow { color: var(--muted); opacity: 0.6; margin-right: 7px; }
.tag {
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 100px;
  padding: 2px 9px;
}

.status { font-size: 12px; color: var(--muted); margin: 0 0 18px; }
.status:empty { display: none; }
.empty { display: none; padding: 40px 4px; max-width: 52ch; }
.empty h2 { margin: 0 0 6px; font-size: 15px; color: var(--heading); font-weight: 600; }
.empty p { margin: 0; font-size: 13px; color: var(--muted); }
body[data-empty="true"] .empty { display: block; }
[hidden] { display: none !important; }
footer {
  border-top: 1px solid var(--edge);
  padding: 18px 28px 26px;
  font-size: 12px;
  color: var(--muted);
}
footer code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  color: var(--text);
}

@media (max-width: 900px) {
  .topbar { flex-wrap: wrap; gap: 10px; padding: 12px 18px; }
  .brand { flex: 1 1 100%; min-width: 0; }
  .spacer { display: none; }
  .controls { flex: 1 1 100%; min-width: 0; flex-wrap: nowrap; }
  .controls .kbd { display: none; }
  input.search { width: auto; flex: 1 1 auto; min-width: 0; }
  select.filter { flex: 0 1 auto; min-width: 0; max-width: 40vw; }
  .intro { padding: 20px 18px 16px; }
  .layout { display: block; padding: 20px 18px 56px; }
  nav.rail { position: static; margin-bottom: 26px; }
  .rail-head { padding-left: 0; padding-right: 0; }
  nav.rail a { padding-left: 0; padding-right: 0; }
  nav.rail a:hover, nav.rail a[aria-current="true"] { background: none; color: var(--accent); }
  li.page {
    grid-template-columns: minmax(0, 1fr);
    margin: 0;
    padding: 13px 0;
    border-radius: 0;
  }
  li.page:hover { background: none; box-shadow: none; }
  .page-kind { grid-column: 1; grid-row: auto; order: -1; margin-bottom: 3px; }
  .page-title { font-size: 15.5px; }
}
@media print {
  .topbar, nav.rail, .icon-btn, .status { display: none; }
  body { background: #ffffff; color: #101828; font-size: 11pt; }
  li.page { break-inside: avoid; border-bottom: 1px solid #d8e7f5; }
  a { color: #101828; }
  .page-meta .path::after { content: ""; }
}
`;

/** Inline behavior: filtering, theme, scroll-spy. No dependencies, no network. */
const SCRIPT = /* js */ `
(function () {
  var root = document.documentElement;
  var search = document.getElementById("search");
  var kind = document.getElementById("kind");
  var status = document.getElementById("status");
  var pages = Array.prototype.slice.call(document.querySelectorAll("li.page"));
  var sections = Array.prototype.slice.call(document.querySelectorAll("section[data-section]"));
  var links = Array.prototype.slice.call(document.querySelectorAll("nav.rail a"));
  var total = pages.length;

  function store(key, value) {
    try { window.localStorage.setItem(key, value); } catch (error) { /* file:// or blocked */ }
  }
  function read(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  var saved = read("openwiki-map-theme");
  if (saved === "dark" || saved === "light") root.dataset.theme = saved;
  function prefersDark() {
    return typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  }
  document.getElementById("theme").addEventListener("click", function () {
    var dark = root.dataset.theme ? root.dataset.theme === "dark" : prefersDark();
    root.dataset.theme = dark ? "light" : "dark";
    store("openwiki-map-theme", root.dataset.theme);
  });

  function apply() {
    var query = search.value.trim().toLowerCase();
    var wanted = kind.value;
    var shown = 0;
    pages.forEach(function (page) {
      var hit =
        (query === "" || page.dataset.haystack.indexOf(query) !== -1) &&
        (wanted === "" || page.dataset.kind === wanted);
      page.hidden = !hit;
      if (hit) shown += 1;
    });
    sections.forEach(function (section) {
      var count = section.querySelectorAll("li.page:not([hidden])").length;
      section.hidden = count === 0;
      var link = document.querySelector('nav.rail a[data-section="' + section.dataset.section + '"]');
      if (link) {
        link.hidden = count === 0;
        link.querySelector(".n").textContent = String(count);
      }
    });
    document.body.dataset.empty = shown === 0 ? "true" : "false";
    var filtered = query !== "" || wanted !== "";
    status.textContent = filtered ? shown + " of " + total + " pages match" : "";
  }

  search.addEventListener("input", apply);
  kind.addEventListener("change", apply);
  document.addEventListener("keydown", function (event) {
    if (event.key === "/" && document.activeElement !== search) {
      event.preventDefault();
      search.focus();
      search.select();
    } else if (event.key === "Escape" && document.activeElement === search) {
      search.value = "";
      kind.value = "";
      apply();
    }
  });

  if ("IntersectionObserver" in window) {
    var seen = {};
    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          seen[entry.target.dataset.section] = entry.isIntersecting;
        });
        var active = null;
        sections.forEach(function (section) {
          if (!active && seen[section.dataset.section]) active = section.dataset.section;
        });
        links.forEach(function (link) {
          if (active && link.dataset.section === active) {
            link.setAttribute("aria-current", "true");
          } else {
            link.removeAttribute("aria-current");
          }
        });
      },
      { rootMargin: "-80px 0px -65% 0px" }
    );
    sections.forEach(function (section) { spy.observe(section); });
  }
})();
`;

/** Sun and moon glyphs for the theme control, drawn on a 24px grid. */
const THEME_ICONS = /* html */ `<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2" /><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" /></svg><svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z" /></svg>`;

/** Cap a list of chips, appending a "+N" marker when it overflows. */
function capped<T>(items: T[], limit: number): { shown: T[]; rest: number } {
  return {
    shown: items.slice(0, limit),
    rest: Math.max(0, items.length - limit),
  };
}

/** Render one page as a row in its section's list. */
function renderPage(
  node: WikiNode,
  href: string,
  color: string,
  titles: Map<string, string>,
): string {
  const haystack = escapeHtml(
    [node.title, node.description, node.type, node.id, ...node.tags]
      .join(" ")
      .toLowerCase(),
  );
  const description = node.description
    ? `<p class="page-desc">${escapeHtml(node.description)}</p>`
    : "";
  const tagList = capped(node.tags, 4);
  const tags = tagList.shown.length
    ? `<span class="tags">${tagList.shown
        .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
        .join(
          "",
        )}${tagList.rest ? `<span class="tag more">+${tagList.rest}</span>` : ""}</span>`
    : "";
  const linkList = capped(node.links, 3);
  const related = linkList.shown.length
    ? `<p class="page-leads"><span class="arrow" aria-hidden="true">&rarr;</span>${linkList.shown
        .map(
          (id) =>
            `<a href="#page-${escapeHtml(id)}">${escapeHtml(titles.get(id) ?? id)}</a>`,
        )
        .join(
          '<span class="sep">, </span>',
        )}${linkList.rest ? `<span class="sep">, +${linkList.rest} more</span>` : ""}</span>`
    : "";
  const backlinks = node.backlinks.length
    ? `<span class="sep">&middot;</span><span>${node.backlinks.length} linked here</span>`
    : "";

  return `<li class="page" id="page-${escapeHtml(node.id)}" data-haystack="${haystack}" data-kind="${escapeHtml(node.type)}">
<h3 class="page-title"><span class="dot" style="background:${escapeHtml(color)}"></span><a href="${escapeHtml(href)}">${escapeHtml(node.title)}</a></h3>
<span class="page-kind">${escapeHtml(node.type)}</span>
${description}<p class="page-meta"><span class="path">${escapeHtml(node.id)}.md</span>${tags}<span class="sep">&middot;</span><span>${readingMinutes(node)} min</span>${backlinks}</p>
${related}</li>`;
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
  const colors = colorsForTypes(graph.types);
  const generated = graph.generatedAt.slice(0, 10);
  const pageWord = graph.nodes.length === 1 ? "page" : "pages";
  const sectionWord = sections.length === 1 ? "section" : "sections";

  const rail = sections
    .map(
      (section) =>
        `<li><a href="#section-${escapeHtml(section.id)}" data-section="${escapeHtml(section.id)}">${escapeHtml(section.title)}<span class="n">${section.pages.length}</span></a></li>`,
    )
    .join("\n");

  const kinds = graph.types
    .map(
      (type) =>
        `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`,
    )
    .join("");

  const body = sections
    .map(
      (
        section,
      ) => `<section id="section-${escapeHtml(section.id)}" data-section="${escapeHtml(section.id)}">
<div class="section-head"><h2>${escapeHtml(section.title)}</h2><span class="n">${section.pages.length}</span></div>
<ul class="pages">
${section.pages
  .map((node) =>
    renderPage(
      node,
      markdownHref(outputFile, wikiRoot, node),
      colors[node.type] ?? "#4FA8F0",
      titles,
    ),
  )
  .join("\n")}
</ul>
</section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(graph.root)} wiki map</title>
<meta name="description" content="Table of contents for the ${escapeHtml(graph.root)} OpenWiki: ${graph.nodes.length} ${pageWord} across ${sections.length} ${sectionWord}." />
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#contents">Skip to the pages</a>
<div class="topbar">
<div class="brand"><span class="mark">OpenWiki</span><span class="divider"></span><span class="name">${escapeHtml(graph.root)}<small>Map of contents</small></span></div>
<div class="spacer"></div>
<div class="controls">
<input id="search" class="search" type="search" placeholder="Filter by title, tag, or path" autocomplete="off" aria-label="Filter pages" />
<span class="kbd" aria-hidden="true">/</span>
<select id="kind" class="filter" aria-label="Filter by page type"><option value="">All types</option>${kinds}</select>
<button id="theme" class="icon-btn" type="button" aria-label="Switch between light and dark">${THEME_ICONS}</button>
</div>
</div>
<div class="intro">
<h1><strong>${graph.nodes.length} ${pageWord}</strong> across <strong>${sections.length} ${sectionWord}</strong>, joined by <strong>${graph.edges.length}</strong> links.</h1>
<p>Every title opens the markdown source it was generated from. Built ${escapeHtml(generated)}.</p>
</div>
<div class="layout">
<nav class="rail" aria-label="Sections">
<div class="rail-head"><span>Sections</span><span class="rail-count">${sections.length}</span></div>
<ol>
${rail}
</ol>
</nav>
<main id="contents">
<p id="status" class="status" role="status"></p>
${body}
<div class="empty">
<h2>Nothing matches that filter</h2>
<p>Filters look at titles, descriptions, tags, page types, and file paths. Clear the field with Escape, or reset the type filter to All types.</p>
</div>
</main>
</div>
<footer>Generated by <code>openwiki map</code> on ${escapeHtml(generated)}. Rerun it after a wiki update to refresh this page.</footer>
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
