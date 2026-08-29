---
"openwiki": minor
---

Add `openwiki map`, a subcommand that renders a generated wiki as one standalone HTML table of contents. It lists every page under its section with its type, description, tags, reading time, backlink count, and the pages it leads to, links each title to the Markdown source, and ships an inline filter, a page-type filter, and a light/dark toggle. It follows the visualizer's design language, including the same page-type colors. Styles and script are inlined so the file needs no sibling assets and works offline. Defaults to reading `./openwiki` and writing `./openwiki/map.html`; `--output <file>` writes elsewhere. The `visualize` server and static export are unchanged.
