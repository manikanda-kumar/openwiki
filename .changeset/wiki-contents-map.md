---
"openwiki": minor
---

Add `openwiki map`, a subcommand that renders a generated wiki as one standalone HTML table of contents. It groups every page by section with its type, description, tags, reading time, backlink count, and outgoing links, links each title to the Markdown source, and ships an inline client-side filter. Styles and script are inlined so the file needs no sibling assets and works offline. Defaults to reading `./openwiki` and writing `./openwiki/map.html`; `--output <file>` writes elsewhere. The `visualize` server and static export are unchanged.
