// ONE real OpenServ graph run of S5 (condition unmet) with the real LOCAL Sentinel. kite_pay is MOCK only (no Kite Passport, no USDC).
import { readFileSync, writeFileSync } from "node:fs";
import { runGraph } from "../src/executor.ts";
import { createSession, makeKitePay } from "../src/kitePay.ts";
import { makeServClient } from "../src/servClient.ts";
import { makeThoughtProofVerifier } from "../src/thoughtproof.ts";
import { sentinelBody } from "../src/sentinelBody.ts";
if (process.env.KITE_PAY_MODE === "LIVE") throw new Error("refuse: KITE_PAY_MODE=LIVE");
const s = JSON.parse(readFileSync(new URL("../scenarios/scenarios.json", import.meta.url), "utf8")).find((x: any) => x.id === "S5_condition_unmet");
const cet = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }) + " CET";
let calls = 0; const mock = makeKitePay(createSession({ maxPerTx: 2, maxTotal: 10, ttlMs: 86_400_000, scope: ["did:kite:dataset-shop.test"] }));
const kitePay = (p: any) => { calls++; return mock(p); };
const verify = makeThoughtProofVerifier({ apiKey: "local-test-key", keyHeader: "X-Sentinel-Key", buildBody: sentinelBody, timeoutMs: 60_000, url: "http://127.0.0.1:3011/sentinel/verify" });
const t0 = new Date();
const r: any = await runGraph({ graphId: "gr_df01264afea66dfc", request: s.request, create: makeServClient(), verify, kitePay, runTimeoutMs: 240_000 });
const t1 = new Date();
const tools = (r.audit ?? []).filter((a: any) => a.event === "tool");
const v = tools.find((a: any) => a.name === "verify_before_action");
const out = { scenario: s.id, graph: "gr_df01264afea66dfc", sentinel: "local 127.0.0.1:3011", kite_pay_mode: "MOCK (no Kite Passport, no USDC possible)",
  start: cet(t0), end: cet(t1), duration_ms: t1.getTime() - t0.getTime(),
  verdict: v?.result?.verdict ?? null, receipt_id: v?.result?.receipt_id ?? null, reason: v?.result?.reason ?? null,
  verify_calls: tools.filter((a: any) => a.name === "verify_before_action").length,
  kite_pay_tool_calls_by_graph: tools.filter((a: any) => a.name === "kite_pay").length, kite_pay_executed_calls: calls,
  executed: r.executed, final: r.final, error: r.error ?? null, rounds: r.rounds,
  openserv: (r.usage ?? []).map((u: any) => ({ response_id: u.id, request_id: u.request_id, status: u.status, usage: u.usage, output_types: u.output_types })),
  audit: r.audit };
writeFileSync("live-s5-result.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, audit: undefined, openserv: out.openserv.map((o: any) => ({ response_id: o.response_id, request_id: o.request_id, status: o.status })) }, null, 1));
