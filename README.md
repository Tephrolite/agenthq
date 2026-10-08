# Agent HQ Budget Controller

This is the minimal Fastify/TypeScript backend foundation for enforcing application-side OpenAI spend limits. `ModelGateway` is the only authorized execution boundary; model clients are injected into it and callers must not create their own clients. `OpenAIResponsesClient` is the centralized production adapter, configured with retries disabled and without tools, handoffs, or autonomous-agent capabilities.

## Configuration

Copy `.env.example` to `.env` and set these required limits. Invalid, missing, zero, or negative budget settings stop execution rather than allowing unlimited use.

| Variable | Example | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | secret | Required only by a future production client; never log it. |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Initial allowed model. |
| `AGENT_HQ_MONTHLY_BUDGET_USD` | `5` | Monthly application budget. |
| `AGENT_HQ_MAX_TASK_COST_USD` | `0.10` | Maximum budget committed to one task. |
| `AGENT_HQ_MAX_MODEL_CALLS_PER_TASK` | `6` | Maximum calls recorded for a task. |
| `AGENT_HQ_MAX_CONCURRENT_RUNS` | `1` | Maximum requests in flight. |
| `AGENT_HQ_AUTONOMOUS_RUNS_ENABLED` | `false` | Autonomous calls require explicit enablement. |
| `AGENT_HQ_MODEL_TIMEOUT_MS` | `30000` | Per-request timeout. |
| `AGENT_HQ_MAX_OUTPUT_TOKENS` | `1200` | Hard output-token ceiling. |

Costs use integer microdollars. GPT-5.4 mini rates are centrally configured as $0.75/M input tokens, $0.075/M cached input tokens, and $4.50/M output tokens. Output usage includes reasoning tokens when reported by the provider.

## Reservation Process

Before calling a model, the gateway validates pricing, autonomous permission, per-task call count, task commitment, monthly commitment, concurrency, and explicit input/output token ceilings. It atomically records a reservation in the ledger before awaiting the provider. Successful calls replace the reservation with reported cost. Only an explicitly known-not-sent provider failure is marked failed and releases spending capacity; missing usage, timeouts, and other provider outcomes retain the reservation.

The included `InMemoryExecutionLedger` is a development implementation. It is isolated behind `ExecutionLedger`; replace it with a PostgreSQL transaction that locks the monthly/task aggregates before production or multi-process deployment.

## Commands

```powershell
npm install
npm test
npm run check
npm run start
```

`GET /budget/report` exposes estimated usage, reserved spending, remaining budget, counts, and per-model usage. It never returns credentials.

## Controlled Live Test

No live request is made by this project. Before adding a production OpenAI client, use a separately authorized test task with a low task limit and a dedicated API key. Verify `/budget/report` before and after, then revoke or rotate the test key if exposure is suspected.

## Limitations

Application limits are independent of OpenAI billing limits and provider usage may be delayed or incomplete. Cached-token usage is conservatively estimated as uncached before execution. The development ledger is process-local; a PostgreSQL transaction-backed implementation is required for durable, multi-instance atomic accounting. Agent handoffs, autonomous workflows, retries, and paid tools are intentionally not enabled.