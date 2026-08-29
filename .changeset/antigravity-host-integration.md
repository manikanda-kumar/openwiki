---
"openwiki": minor
---

Add Antigravity to the supported coding-agent integrations. `openwiki integrations install antigravity` installs the OpenWiki skill under `~/.gemini/config/skills/openwiki` and a managed `openwiki` entry in `~/.gemini/config/mcp_config.json`, so the Antigravity CLI (`agy`) can drive the same five-operation MCP page-job lifecycle as the other hosts. Antigravity is user-scope only because its CLI reads MCP servers from a single global config; `--project` is rejected for that host with a clear message, and `openwiki integrations list --project` reports it as `unsupported`.
