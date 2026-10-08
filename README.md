# Agent HQ: Chief of Staff v1

A local Fastify/TypeScript backend with approval-controlled research. The Chief of Staff prepares a deterministic plan without spending, pauses for approval, and makes one bounded Responses API call to synthesize supplied evidence. It does not fetch source URLs or run live searches. Its JSON brief contains a summary, findings with source IDs, uncertainties, and next steps. Schema enforcement and local validation reject malformed output or unknown source IDs; references are not independent fact verification.

## Setup

Use Node 22 or newer. Copy `.env.example` to `.env`, set your API key locally, then run:

```sh
npm ci
npm test
npm run check
npm run build
npm start
```

The server binds to `127.0.0.1:3000`. This is a local prototype with no authentication; approval means a deliberate request from the operator. Do not expose it publicly. Run exactly one server process against a data directory. PostgreSQL transactions and authentication are prerequisites for multi-instance or hosted use.

## Limits

| Setting | Default |
| --- | --- |
| Monthly application budget | $5 |
| Maximum task commitment | $0.10 |
| Maximum calls per task | 6; this workflow uses only 1 |
| Concurrent workflows | 1 |
| Output tokens | At most 1200, or the configured lower cap |
| Source material | 1–5 sources, 6000 characters per source, 16000 total text bytes |
| Retries, scheduling, delegation, paid tools | Disabled |

`ModelGateway` remains the only model execution boundary. It reserves estimated cost before dispatch, enforces task and monthly limits, and records reported usage afterward. Input reservations use a conservative UTF-8 byte bound including the response schema plus framing allowance. Costs use integer microdollars; existing GPT-5.4 mini pricing is retained in `src/billing/pricing.ts` and must be reviewed when provider pricing changes. Responses use `store: false`, strict JSON schema output, no tools, and SDK retries disabled.

Accounting and tasks persist to `data/executions.json` and `data/research.json`, excluded from git. Override the directory using `AGENT_HQ_DATA_DIR`. Protect and back up this directory: deleting it resets accounting and loses approvals and research. Writes use temporary files and atomic rename. Interrupted executions become uncertain on restart and keep their spending reservation; interrupted workflows become failed and never resume automatically. Corrupt JSON stops startup. This is single-process local persistence, not a transaction-backed production ledger.

Monthly reports use UTC calendar months; older unresolved reservations remain charged against available capacity until reconciled. Provider failures, timeouts, missing usage, and uncertain outcomes retain reservations; explicitly known-not-sent failures release them. Application accounting covers only requests through this gateway, independent of provider billing.

## First workflow

Create a task with actual source excerpts. Source URLs are labels only and are never fetched.

```sh
curl -s http://127.0.0.1:3000/research/tasks \
  -H 'Content-Type: application/json' \
  -d '{"question":"What execution controls are implemented?","sources":[{"id":"s1","title":"Foundation excerpt","url":"https://github.com/Tephrolite/agenthq","text":"ModelGateway reserves budget before executing requests. SDK retries are disabled. Autonomous calls are disabled by configuration."}]}'
```

Inspect the returned plan and replace `TASK_ID` below with its ID. Approval applies to that immutable question, source bundle, and plan.

```sh
curl -s http://127.0.0.1:3000/research/tasks/TASK_ID
curl -s -X POST http://127.0.0.1:3000/research/tasks/TASK_ID/approve
curl -s -X POST http://127.0.0.1:3000/research/tasks/TASK_ID/run
curl -s http://127.0.0.1:3000/budget/report
```

Only `/run` makes a model call and incurs API usage. Its response includes task status and, on success, the brief. A failed task does not retry. Check the budget report and task events before creating a replacement.

`POST /research/tasks/TASK_ID/cancel` cancels pending, approved, or running tasks. A running request may still complete and incur usage; its brief is discarded and its cost remains recorded. Completed and failed tasks are terminal. Duplicate execution and execution before approval return HTTP 409. Unknown tasks return 404, and malformed requests return 400.

## Verification

`npm test` exercises approval gating, duplicate execution, concurrent workflows, cancellation during execution, invalid citations, source limits, budget rejection, durable state, restart recovery, input bounds, and monthly accounting using mock clients. Tests make no paid API requests. The live OpenAI adapter requires a local API key and has not been verified by these mock tests.

## Next milestone

Add bounded live retrieval with tool costs in the same ledger, then a UI showing plans, approvals, task events, and budget usage. Keep source content untrusted, and retain explicit approval before any capability expansion.
