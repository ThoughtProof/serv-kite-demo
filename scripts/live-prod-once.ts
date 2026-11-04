// ONE real Kite Passport PROD payment (anchor-x402 /v1/roll, 0.001 USDC on Base) via TP gate (local Sentinel #115). Never prints keys.
import { runGraph } from "../src/executor.ts";
import { makeKitePayLive } from "../src/kitePayLive.ts";
import { makeServClient } from "../src/servClient.ts";
import { makeThoughtProofVerifier } from "../src/thoughtproof.ts";
import { sentinelBody } from "../src/sentinelBody.ts";
import { writeFileSync } from "node:fs";
const R = "did:kite:api.anchor-x402.com";
const req = { amount: 0.001, asset: "USDC", recipient: R, purpose: "rng_roll",
  mandate: `Buy one verifiable RNG roll, max 0.01 USDC, from ${R}, purpose rng_roll.`, granted: { maxAmount: 0.01, asset: "USDC", recipient: R } };
let calls = 0; const live = makeKitePayLive({ maxPerTx: 0.01 });
const kitePay = (p: any) => { calls++; return live(p); };
const verify = makeThoughtProofVerifier({ apiKey: "local-test-key", keyHeader: "X-Sentinel-Key", buildBody: sentinelBody, timeoutMs: 60_000, url: "http://127.0.0.1:3011/sentinel/verify" });
const r: any = await runGraph({ graphId: "gr_df01264afea66dfc", request: req, create: makeServClient(), verify, kitePay, runTimeoutMs: 240_000 });
const tools = (r?.audit ?? []).filter((a: any) => a.event === "tool");
const v = tools.find((a: any) => a.name === "verify_before_action"); const pays = tools.filter((a: any) => a.name === "kite_pay");
const out = { executed: r.executed, final: r.final, verdict: v?.result?.verdict, receipt_id: v?.result?.receipt_id, reason: String(v?.result?.reason ?? "").slice(0, 300), kite_calls: calls, pays: pays.map((p: any) => p.result), error: r.error ?? null,
  rounds: r.rounds ?? null, final_raw: r.final ?? null,
  // Full graph trace for diagnosis: tool events (kite_pay detail is already redacted by the adapter) + per-round usage/output_types.
  audit: r.audit ?? [], usage: (r.usage ?? []).map((u: any) => ({ id: u.id, request_id: u.request_id, status: u.status, usage: u.usage, output_types: u.output_types })) };
writeFileSync(process.env.RESULT_FILE ?? "live-prod-once-result.json", JSON.stringify(out, null, 2));
// Human-readable trace for the recording (no secrets: detail/stderr are not printed).
const P = out.pays[0] ?? {}; let mb: any = null; try { mb = JSON.parse(P.merchant_body ?? "null"); } catch {}
const L = (s = "") => console.log(s);
L(); L("══════════════════════════════════════════════════════════════════════════════");
L(" ThoughtProof x OpenServ x Kite · Pay only on ALLOW · LIVE (Kite Passport prod, USDC on Base)");
L("══════════════════════════════════════════════════════════════════════════════");
L(` [1] Mandate   0.001 USDC -> ${R} · purpose rng_roll · max 0.01 USDC`);
L(` [2] Gate      ThoughtProof Sentinel verdict: ${out.verdict}   receipt ${out.receipt_id}`);
L(` [3] Payment   kpass agent:session execute (Kite Passport prod) · kite_pay calls: ${out.kite_calls}`);
L(`               ok=${P.ok} · network ${P.network ?? "-"} (chain ${P.chain_id ?? "-"}) · amount ${P.amount ?? "-"} USDC · session spent ${P.spent_total ?? "-"}`);
L(`               tx ${P.tx_id ?? "-"}`);
if (P.tx_id) L(`               https://basescan.org/tx/${P.tx_id}`);
if (!P.ok) L(`               error: ${P.error ?? out.final}`);
if (mb) { L(` [4] Merchant  anchor-x402 /v1/roll → result ${JSON.stringify(mb.result)} in [${mb.range}]`);
  L(`               signed ${mb.scheme} by ${mb.signer}`); L(`               signature ${String(mb.signature ?? "").slice(0, 42)}…`); L(`               result_hash ${mb.result_hash}`); }
L("══════════════════════════════════════════════════════════════════════════════");
