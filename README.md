# Pay only if: OpenServ Graph + ThoughtProof gate + Kite-style session (Hackathon 02, Kite track)

Status: default mode is **MOCK** (no funds). With `KITE_PAY_MODE=LIVE` the same gated path paid **real USDC on Base** through Kite Passport production (see "Real payment on Base" below).

Honesty note: ThoughtProof is an additional check before execution, not a guarantee ("second opinion before money moves; executes only on ALLOW"). Known false-alarm rate is high.

## v3 (live graph)
Graph `gr_df01264afea66dfc` ('pay-only-if-kite-demo-v3', from graph/graph-prompt-v3.txt): verify_payment (Agent) → check_verdict (Decision allow/not_allow) → execute_payment (Agent) → check_payment_error → report_error/report_paid; not_allow → report_hold.
The graph has **no rules Script node**: the app runs src/rules.js first and calls the graph only on pass (REJECTED_BY_RULES never reaches SERV).
Request: `model=gr_…`, `instructions` (short system line, required by the API), `input` = request JSON, `tools` = verify_before_action + kite_pay (function tools, run by the app).
Live runner: `node scripts/run-scenarios-live.ts [gr_id]`, one run per scenario, no retries; ThoughtProof LIVE only if THOUGHTPROOF_API_KEY is set, otherwise **MOCK (labeled)**; Kite MOCK unless `KITE_PAY_MODE=LIVE`. Gate unchanged: kite_pay only after a recorded ALLOW for the same payment digest, single use.

## Flow
Script rules (free, no model) → Agent calls `verify_before_action` → Decision ALLOW/BLOCK/UNCERTAIN → on ALLOW only Agent calls `kite_pay` → app enforces session limits.
See graph/graph-spec.md (+ .json).

## Files
- src/rules.js: Script step (sandbox-safe JS)
- src/executor.ts: tool-executor loop (function_call → function_call_output, previous_response_id)
- src/servClient.ts: OpenServ Responses client (key from SERV_API_KEY)
- src/thoughtproof.ts: verify adapter, fail-closed (key from THOUGHTPROOF_API_KEY). Payload shape to be confirmed against the live gate before first real call.
- src/gate.ts: reusable gate: action runs only after ALLOW on the same digest, single use
- src/kitePay.ts: kite_pay MOCK with max-per-tx, max-total, TTL, scope, asset
- scenarios/scenarios.json: 4 scenarios
- scripts/run-scenarios-offline.ts, scripts/metric.ts
- test/: offline tests with mocked OpenServ + mocked verify

## Run (Node ≥ 23.6, no deps)
    npm test
    npm run scenarios
    npm run metric -- 100

Metric = 1 − (Agent-step visits / requests) on a synthetic mix (60/25/15). The number depends on the mix.

## Kite testnet
Verified 2 Nov 2026 (kpass 1.8.0, backend https://passport.dev.gokite.ai): Kite testnet is chain **2368** (CAIP-2 `eip155:2368`); the faucet (`kpass faucet drop`) pays **pieUSD** (18 decimals) to the Passport wallet on chain `kite`. The dev test merchant `https://passport.dev.gokite.ai/x402/test` asks 0.1 pieUSD on eip155:2368, but Passport refuses it for paid execution (`payment_target_forbidden`, host not in executable catalog). The only dev catalog gateway (`kite-services-dev.kiteai.dev`) prices in Bridged USDC on chain 2366 (not testnet), so it is not used. Default is still MOCK. A LIVE adapter (`src/kitePayLive.ts`, `KITE_PAY_MODE=LIVE`, `KITE_X402_URL=<https url>`) calls `kpass agent:session execute` only after ALLOW and fails closed unless the result is HTTP 2xx on chain 2368 with a tx hash.

## Real payment on Base (Kite Passport production, 4 Nov 2026)
Flow: app rules → OpenServ graph `gr_df01264afea66dfc` → ThoughtProof Sentinel (local #115, enforce) `verify_before_action` → **ALLOW** → `kite_pay` LIVE → `kpass agent:session execute` (backend `https://passport.prod.gokite.ai`) → x402 payment in **USDC on Base** (eip155:8453) to a merchant from Kite's production service catalog.
- Merchant: **anchor-x402** (`ksearch` catalog id `11639e776ee76901bb491ef7`), `POST https://api.anchor-x402.com/v1/roll`, 0.001 USDC, body `{"low":1,"high":100,"count":1,"label":"thoughtproof-kite-demo"}`; returns an eip191-signed random integer.
- Session: requested by the agent with a scoped delegation (only `POST api.anchor-x402.com/v1/roll`, max 0.01 USDC/tx, max 0.05 USDC total, 1 h TTL) and **approved by a human** on agentpassport.ai before any payment.
- Run 1 (18:18 CET): gate ALLOW receipt `sent_4825518fb9d1485a`, paid 0.001 USDC — tx [0xae7ea577…59fc8](https://basescan.org/tx/0xae7ea577e89c2d0d264e1359c9b453b7e88a5691dc7f444843d67fa525c59fc8).
- Run 2 (18:21 CET): gate ALLOW receipt `sent_7e50167be3204798`, paid 0.001 USDC — tx [0xe152eed8…ff75c](https://basescan.org/tx/0xe152eed87817b84fdabbe84a3ca2efb3167179959d86f3d01a8fd1d9b35ff75c), RNG result **12** (range 1–100, signer `0x127462e296fAc1A7F5cF33bA57bB2f0FFf5cD0B6`).
- Both runs were first recorded as `ok:false` by an adapter bug (settlement chain read from the wrong field; `x402.chain_id` 2366 is the Passport's Kite chain, settlement is `x402.payment_response.network`). Fixed; result files carry an `annotation`. An earlier attempt (18:14 CET, body `{}`) was rejected by the merchant and did not settle.
- Run it: `KITE_PAY_MODE=LIVE KITE_PASSPORT_BASE_URL=https://passport.prod.gokite.ai KITE_X402_URL=https://api.anchor-x402.com/v1/roll KITE_X402_METHOD=POST KITE_X402_BODY='{"low":1,"high":100}' KITE_X402_HEADERS='{"Content-Type":"application/json"}' KPASS_CWD=/workspace node scripts/live-prod-once.ts` (needs an approved session; one payment per run).
- Adapter (`src/kitePayLive.ts`) fails closed unless: backend is allowlisted (dev → chain 2368, prod → Base 8453 only), `x402.payment_response.success === true`, network `eip155:8453`, a tx hash, and merchant HTTP 2xx. kpass output is persisted redacted on every outcome.
