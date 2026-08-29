/**
 * Behavior of the generated map page itself: the inline filter, the empty state,
 * and the theme toggle, exercised in jsdom the way a reader would drive them.
 */
import { JSDOM } from "jsdom";
import { beforeEach, expect, test } from "vitest";
import { renderContentsMap } from "../../src/visualize/contents-map.ts";
import type { WikiGraph, WikiNode } from "../../src/visualize/graph.ts";

function page(overrides: Partial<WikiNode> & Pick<WikiNode, "id">): WikiNode {
  return {
    title: overrides.id,
    type: "Reference",
    description: "",
    tags: [],
    body: "",
    size: 0,
    links: [],
    backlinks: [],
    ...overrides,
  };
}

const graph: WikiGraph = {
  root: "openwiki",
  generatedAt: "2026-08-29T00:00:00.000Z",
  types: ["Concept", "Section"],
  nodes: [
    page({
      id: "index",
      title: "Home",
      type: "Section",
      links: ["concepts/claims"],
    }),
    page({
      id: "concepts/claims",
      title: "Grounded Claims",
      type: "Concept",
      description: "Evidence behind every generated page.",
      tags: ["claims", "evidence"],
      backlinks: ["index"],
    }),
    page({ id: "concepts/modes", title: "Two Modes", type: "Concept" }),
  ],
  edges: [{ source: "index", target: "concepts/claims" }],
};

let dom: JSDOM;
let doc: Document;

function visiblePages(): string[] {
  return [...doc.querySelectorAll("li.page:not([hidden])")].map(
    (li) => li.querySelector(".page-title a")?.textContent ?? "",
  );
}

function type(value: string): void {
  const search = doc.getElementById("search") as HTMLInputElement;
  search.value = value;
  search.dispatchEvent(new dom.window.Event("input"));
}

beforeEach(() => {
  const html = renderContentsMap(graph, "/wiki/map.html", "/wiki");
  dom = new JSDOM(html, { runScripts: "dangerously", url: "https://x.test/" });
  doc = dom.window.document;
});

test("filters pages, sections, and the rail together", () => {
  expect(visiblePages()).toHaveLength(3);

  type("claims");

  expect(visiblePages()).toEqual(["Grounded Claims"]);
  const rootSection = doc.querySelector('section[data-section="__root"]');
  expect((rootSection as HTMLElement).hidden).toBe(true);
  const rail = doc.querySelector(
    'nav.rail a[data-section="concepts"]',
  ) as HTMLElement;
  expect(rail.hidden).toBe(false);
  expect(rail.querySelector(".n")?.textContent).toBe("1");
  expect(doc.getElementById("status")?.textContent).toBe("1 of 3 pages match");
});

test("matches descriptions and tags, not just titles", () => {
  type("evidence");
  expect(visiblePages()).toEqual(["Grounded Claims"]);
});

test("filters by page type", () => {
  const kind = doc.getElementById("kind") as HTMLSelectElement;
  kind.value = "Section";
  kind.dispatchEvent(new dom.window.Event("change"));

  expect(visiblePages()).toEqual(["Home"]);
});

test("shows the empty state and clears it again", () => {
  type("nothing-matches-this");

  expect(doc.body.dataset.empty).toBe("true");
  expect(doc.querySelector(".empty h2")?.textContent).toContain("Nothing");

  type("");

  expect(doc.body.dataset.empty).toBe("false");
  expect(visiblePages()).toHaveLength(3);
  expect(doc.getElementById("status")?.textContent).toBe("");
});

test("escape clears the filter while the search box is focused", () => {
  const search = doc.getElementById("search") as HTMLInputElement;
  type("claims");
  search.focus();

  doc.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

  expect(search.value).toBe("");
  expect(visiblePages()).toHaveLength(3);
});

test("slash focuses the search box from anywhere on the page", () => {
  doc.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "/", bubbles: true }),
  );

  expect(doc.activeElement?.id).toBe("search");
});

test("the theme toggle flips the theme and remembers it", () => {
  const button = doc.getElementById("theme") as HTMLButtonElement;

  button.click();
  expect(doc.documentElement.dataset.theme).toBe("dark");
  expect(dom.window.localStorage.getItem("openwiki-map-theme")).toBe("dark");

  button.click();
  expect(doc.documentElement.dataset.theme).toBe("light");
});

test("type colors match the visualizer legend", () => {
  const dots = [...doc.querySelectorAll("li.page .dot")].map((dot) =>
    (dot as HTMLElement).style.background.replace(/\s/gu, ""),
  );
  // colorsForTypes assigns PALETTE by sorted type order: Concept, then Section.
  expect(dots).toEqual([
    "rgb(182,222,62)",
    "rgb(79,168,240)",
    "rgb(79,168,240)",
  ]);
});
