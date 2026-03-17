# Roadmap: Agent-Friendly Plasma Bot

## Phase 1: Open Agent API (Current)

Public API endpoint for agents and scripts to request plasma programmatically.

- `POST /api/agent/fuse` — machine-readable fuse endpoint with structured error codes
- `GET /api/openapi.json` — OpenAPI 3.0 spec for auto-generated clients
- `llms.txt` — LLM-discoverable description following [llmstxt.org](https://llmstxt.org) convention
- Separate rate limits and audit trail (`source: 'api'`) from web/Telegram traffic

## Phase 2: 402 Agentic Payments (Future)

Agents pay QSR or ZNN to fuse plasma, unlocking permissionless usage beyond rate limits.

- `POST /api/agent/fuse` without payment returns `402 Payment Required` with payment instructions
- Agent completes on-chain payment and retries with proof
- Web and Telegram flows remain free and unchanged

## Phase 3: MCP Server / Tool-Use Integration (Future)

Expose the plasma bot as an MCP tool so AI agents can fuse plasma as part of multi-step workflows.

- MCP server wrapping the agent API
- Tool definitions for fuse, check status, and monitor balance
- Compatible with Claude, GPT, and other tool-use frameworks
