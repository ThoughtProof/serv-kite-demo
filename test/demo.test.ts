import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runGraph } from "../src/executor.ts";
import { createSession, makeKitePay } from "../src/kitePay.ts";
import { makeThoughtProofVerifier } from "../src/thoughtproof.ts";
import { evaluateRules } from "../src/rules.js";
import { makeMockServ } from "./mockServ.ts";

const scope = ["did:kite:weather-api.test", "did:kite:dataset-shop.test"];
const sess = () => createSession({ maxPerTx: 2, maxTotal: 10, ttlMs: 86_400_000, scope });
const good = { amount: 0.05, asset: "USDC", recipient: scope[0], purpose: "weather_api_call", mandate: "buy weather call" };
const run = (verdict: any, o: any = {}, req: any = good) => {
  let paid = 0; const kp = makeKitePay(sess());
  return runGraph({ graphId: "MOCK", request: req, create: makeMockServ(o).create,
    verify: typeof verdict === "function" ? verdict : async () => ({ verdict, reason: "mock" }),
    kitePay: (p) => { paid++; return kp(p); } }).then(r => ({ ...r, paid }));
};

for (const s of JSON.parse(readFileSync(new URL("../scenarios/scenarios.json", import.meta.url), "utf8")))
  test(`scenario ${s.id}`, async () => {
    const r = await run(s.mockVerdict, {}, s.request);
    assert.equal(r.executed ? "EXECUTED" : String(r.final).split(" ")[0], s.expect);
  });

for (const v of ["BLOCK", "UNCERTAIN", "weird", undefined])
  test(`verdict ${v} never pays, even with rogue agent`, async () => {
    for (const rogue of [false, true]) { const r = await run(v, { rogue }); assert.equal(r.paid, 0); assert.equal(r.executed, false); }
  });

test("rogue agent calling kite_pay in same round as verify: gate blocks before ALLOW recorded? order matters", async () => {
  // verify is processed first in the round, so ALLOW then pay is legit; the ALLOW is consumed once.
  const r = await run("ALLOW", { rogue: true });
  assert.equal(r.paid, 1); // second kite_pay (c3) is not a rogue path on ALLOW; total payments exactly 1 (no replay)
});

test("verify ALLOW for different amount does not authorize kite_pay", async () => {
  const create = async (b: any) => b.previous_response_id
    ? (b.previous_response_id === "r1" ? { id: "r2", output: [{ type: "function_call", call_id: "c2", name: "kite_pay", arguments: JSON.stringify({ ...good, amount: 1.99 }) }] } : { id: "r3", output: [] })
    : { id: "r1", output: [{ type: "function_call", call_id: "c1", name: "verify_before_action", arguments: JSON.stringify(good) }] };
  let paid = 0;
  const r = await runGraph({ graphId: "X", request: good, create, verify: async () => ({ verdict: "ALLOW", reason: "" }), kitePay: () => { paid++; return { ok: true }; } });
  assert.equal(paid, 0); assert.equal(r.executed, false);
});

test("app re-applies rules even if graph skipped Script step", async () => {
  const bad = { ...good, recipient: "did:kite:evil.test" };
  const create = async (b: any) => b.previous_response_id ? { id: "r9", output: [] }
    : { id: "r1", output: [{ type: "function_call", call_id: "c1", name: "verify_before_action", arguments: JSON.stringify(bad) }, { type: "function_call", call_id: "c2", name: "kite_pay", arguments: JSON.stringify(bad) }] };
  let verifies = 0, paid = 0;
  await runGraph({ graphId: "X", request: bad, create, verify: async () => { verifies++; return { verdict: "ALLOW", reason: "" }; }, kitePay: () => { paid++; return { ok: true }; } });
  assert.equal(verifies, 0); assert.equal(paid, 0);
});

test("tool round limit stops infinite loop", async () => {
  let i = 0;
  const create = async () => ({ id: `r${++i}`, output: [{ type: "function_call", call_id: "c", name: "verify_before_action", arguments: JSON.stringify(good) }] });
  const r = await runGraph({ graphId: "X", request: good, create, verify: async () => ({ verdict: "BLOCK", reason: "" }), kitePay: () => ({ ok: true }) });
  assert.equal(r.rounds, 11); assert.equal(r.executed, false);
});

test("previous_response_id and function_call_output are sent", async () => {
  const m = makeMockServ(); const kp = makeKitePay(sess());
  await runGraph({ graphId: "abc", request: good, create: m.create, verify: async () => ({ verdict: "ALLOW", reason: "" }), kitePay: kp });
  assert.equal(m.calls[0].model, "gr_abc"); assert.ok(m.calls[0].instructions); assert.deepEqual(Object.keys(JSON.parse(m.calls[0].instructions)).sort(), ["amount","asset","mandate","purpose","recipient"]); assert.equal(m.calls[0].tools.length, 2); assert.equal(m.calls[1].tools.length, 2); assert.equal(m.calls[1].instructions, undefined);
  assert.equal(m.calls[1].previous_response_id, "resp_mock_1");
  assert.equal(m.calls[1].input[0].type, "function_call_output");
});

test("kite_pay session limits (MOCK)", () => {
  let now = 0; const s = createSession({ maxPerTx: 2, maxTotal: 3, ttlMs: 1000, scope, now: 0 }); const kp = makeKitePay(s, () => now);
  const p = { amount: 1.5, asset: "USDC", recipient: scope[0], purpose: "x" };
  assert.equal(kp({ ...p, amount: 2.5 }).error, "max_per_tx_exceeded");
  assert.equal(kp({ ...p, recipient: "did:kite:evil" }).error, "session_scope_forbidden");
  assert.equal(kp({ ...p, asset: "ETH" }).error, "asset_forbidden");
  assert.equal(kp(p).ok, true); assert.equal(kp(p).ok, true); assert.equal(kp(p).error, "max_total_exceeded");
  assert.equal(kp(p).mode, "MOCK"); now = 1000; assert.equal(kp({ ...p, amount: 0.01 }).error, "session_expired");
});

test("rules", () => {
  assert.equal(evaluateRules(good).pass, true);
  assert.deepEqual(evaluateRules({ ...good, amount: "abc" }).reasons, ["amount_invalid"]);
  assert.deepEqual(evaluateRules({ ...good, amount: 9 }).reasons, ["amount_over_limit"]);
  assert.equal(evaluateRules(null).pass, false);
});

const res = (status: number, body: any = {}) => async () => ({ status, json: async () => body });
for (const [name, f, want] of [
  ["200 ALLOW", res(200, { verdict: "ALLOW" }), "ALLOW"], ["200 BLOCK", res(200, { verdict: "BLOCK" }), "BLOCK"],
  ["200 UNCERTAIN", res(200, { verdict: "UNCERTAIN" }), "UNCERTAIN"], ["200 garbage", res(200, { verdict: "allow" }), "UNCERTAIN"],
  ["401", res(401, { verdict: "ALLOW" }), "UNCERTAIN"], ["429", res(429, { verdict: "ALLOW" }), "UNCERTAIN"],
  ["503", res(503, { verdict: "ALLOW" }), "UNCERTAIN"], ["throw", async () => { throw new Error("ECONNRESET"); }, "UNCERTAIN"],
  ["timeout", () => new Promise(() => {}), "UNCERTAIN"],
] as const) test(`adapter ${name} -> ${want}`, async () => {
  const v = makeThoughtProofVerifier({ fetch: f as any, apiKey: "test-dummy", timeoutMs: 50 });
  assert.equal((await v({ mandate: "m", action: {} })).verdict, want);
});
test("adapter without key -> UNCERTAIN, no fetch", async () => {
  let called = false; const old = process.env.THOUGHTPROOF_API_KEY; delete process.env.THOUGHTPROOF_API_KEY;
  const v = makeThoughtProofVerifier({ fetch: async () => { called = true; return { status: 200, json: async () => ({ verdict: "ALLOW" }) }; } });
  assert.equal((await v({ mandate: "m", action: {} })).verdict, "UNCERTAIN"); assert.equal(called, false);
  if (old !== undefined) process.env.THOUGHTPROOF_API_KEY = old;
});

test("v3: rules fail -> graph never called", async () => {
  const m = makeMockServ();
  const r = await runGraph({ graphId: "gr_x", request: { ...good, amount: 5 }, create: m.create, verify: async () => ({ verdict: "ALLOW", reason: "" }), kitePay: () => ({ ok: true }) });
  assert.equal(m.calls.length, 0); assert.equal(r.reachedGraph, false); assert.match(String(r.final), /^REJECTED_BY_RULES/);
});

test("stale run: resume 400 -> ERROR, no payment", async () => {
  let n = 0, paid = 0;
  const create = async () => { if (n++ === 0) return { id: "r1", output: [{ type: "function_call", call_id: "c1", name: "verify_before_action", arguments: JSON.stringify(good) }] }; throw new Error("openserv_http_400 Run is not waiting for tool outputs."); };
  const r: any = await runGraph({ graphId: "gr_x", request: good, create, verify: async () => ({ verdict: "ALLOW", reason: "" }), kitePay: () => { paid++; return { ok: true }; } });
  assert.equal(r.executed, false); assert.equal(paid, 0); assert.equal(r.error, "stale_run");
});

test("run timeout: no resume past deadline", async () => {
  let calls = 0;
  const create = async () => { calls++; return { id: "r1", output: [{ type: "function_call", call_id: "c1", name: "verify_before_action", arguments: JSON.stringify(good) }] }; };
  const r: any = await runGraph({ graphId: "gr_x", request: good, create, runTimeoutMs: 0, verify: async () => { await new Promise(r => setTimeout(r, 5)); return { verdict: "ALLOW", reason: "" }; }, kitePay: () => ({ ok: true }) });
  assert.equal(calls, 1); assert.equal(r.executed, false); assert.equal(r.error, "run_timeout");
});

test("sentinel body: granted from app request, reasoning parsed", async () => {
  const { sentinelBody } = await import("../src/sentinelBody.ts");
  const b: any = sentinelBody({ mandate: "m", action: { amount: 1, asset: "USDC", recipient: "r", purpose: "p" }, granted: { maxAmount: 0.5, asset: "USDC", recipient: "r" } });
  assert.deepEqual(b.mandate.granted, { maxAmount: 0.5, asset: "USDC", recipient: "r", allowUnlimited: false }); assert.equal(b.gateMode, "enforce");
  const b2: any = sentinelBody({ mandate: "m", action: { amount: 9, asset: "X", recipient: "evil", purpose: "p" }, appPayment: { amount: 0.3, asset: "USDC", recipient: "r", purpose: "q" } });
  assert.match(b2.evidence, /amount=0.3 asset=USDC recipient=r purpose=q/); assert.doesNotMatch(b2.evidence, /evil/);
  const { makeThoughtProofVerifier } = await import("../src/thoughtproof.ts");
  const v = makeThoughtProofVerifier({ apiKey: "k", timeoutMs: 50, fetch: async () => ({ status: 200, json: async () => ({ verdict: "BLOCK", reasoning: "why", id: "sent_x" }) }) });
  const r = await v({ mandate: "m", action: {} }); assert.equal(r.reason, "why"); assert.equal(r.receipt_id, "sent_x");
});

// fix-retest: repeated verify for the same payment replays the FIRST verdict (no re-roll), both directions.
import { Gate as _G } from "../src/gate.ts";
test("gate: first verdict per digest is binding (ALLOW not overwritten, BLOCK not upgraded)", async () => {
  const a = { amount: 0.06, asset: "USDC", recipient: "r", purpose: "p" };
  const g1 = new _G(); g1.record(a, { verdict: "ALLOW", reason: "" }); g1.record(a, { verdict: "UNCERTAIN", reason: "" });
  assert.equal(g1.recorded(a)?.verdict, "ALLOW"); assert.deepEqual(await g1.execute(a, () => ({ ok: true })), { ok: true });
  const g2 = new _G(); g2.record(a, { verdict: "BLOCK", reason: "" }); g2.record(a, { verdict: "ALLOW", reason: "" });
  assert.equal(g2.recorded(a)?.verdict, "BLOCK"); assert.deepEqual(await g2.execute(a, () => ({ ok: true })), { ok: false, error: "not_allowed_by_gate" });
});

test("S5: rules pass, app evidence reaches Sentinel body, BLOCK never pays", async () => {
  const s = JSON.parse(readFileSync(new URL("../scenarios/scenarios.json", import.meta.url), "utf8")).find((x: any) => x.id === "S5_condition_unmet");
  assert.equal(evaluateRules(s.request).pass, true);
  const { sentinelBody } = await import("../src/sentinelBody.ts");
  let body: any = null;
  const r = await run(async (a: any) => { body = sentinelBody(a); return { verdict: "BLOCK", reason: "condition unmet" }; }, { rogue: true }, s.request);
  assert.equal(r.paid, 0); assert.equal(r.executed, false);
  assert.match(body.evidence, /App-supplied evidence.*delivered=false/); assert.match(body.evidence, /checksum_match=false/);
  assert.equal(body.mandate.action.amount, 0.05); assert.equal(body.mandate.granted.recipient, "did:kite:dataset-shop.test");
  const b0: any = sentinelBody({ mandate: "m", action: { amount: 1, asset: "USDC", recipient: "r", purpose: "p" } });
  assert.doesNotMatch(b0.evidence, /App-supplied/);
});
