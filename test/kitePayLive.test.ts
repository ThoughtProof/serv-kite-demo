import { test } from "node:test";
import assert from "node:assert/strict";
import { makeKitePayLive, isLive, redact } from "../src/kitePayLive.ts";
const pay = { amount: 0.1, asset: "pieUSD", recipient: "did:kite:x", purpose: "t" };
const TX = "0x" + "a".repeat(64);
const ok = { status: "success", x402: { status_code: 200, chain_id: 2368 }, payment: { payment_response: { reference: TX } } };
const R = (code: number, out: any) => async () => ({ code, stdout: typeof out === "string" ? out : JSON.stringify(out) });
const mk = (runner: any, o: any = {}) => makeKitePayLive({ url: "https://m.example/x", env: {}, runner, ...o });

test("default mode is MOCK", () => { assert.equal(isLive({}), false); assert.equal(isLive({ KITE_PAY_MODE: "LIVE" }), true); });
test("LIVE success returns real tx", async () => { const r: any = await mk(R(0, ok))(pay); assert.equal(r.ok, true); assert.equal(r.mode, "LIVE"); assert.equal(r.tx_id, TX); });
test("fail closed: kpass error / bad json / no tx / wrong chain / 402 / missing url / prod base / over cap / second call", async () => {
  for (const r of [await mk(R(6, { status: "error", error_code: "payment_target_forbidden" }))(pay), await mk(R(0, "garbage"))(pay),
    await mk(R(0, { ...ok, payment: {} }))(pay), await mk(R(0, { ...ok, x402: { status_code: 200, chain_id: 2366 } }))(pay),
    await mk(R(0, { ...ok, x402: { status_code: 402, chain_id: 2368 } }))(pay), await makeKitePayLive({ env: {}, runner: R(0, ok) })(pay),
    await mk(R(0, ok), { baseUrl: "https://passport.evil.example" })(pay), await mk(R(0, ok), { baseUrl: "https://passport.prod.gokite.ai" })(pay), await mk(R(0, ok))({ ...pay, amount: 0.5 }),
    await mk(async () => { throw new Error("x"); })(pay)]) { assert.equal(r.ok, false); assert.equal(r.mode, "LIVE"); }
  const k = mk(R(0, ok)); await k(pay); const r2: any = await k(pay); assert.equal(r2.error, "live_single_payment_per_run");
});
test("prod allowlisted: Base chain ok, body passed, testnet chain rejected", async () => {
  let args: string[] = [];
  const okb = { status: "success", x402: { status_code: 200, chain_id: 2366, payment_response: { network: "eip155:8453", success: true, transaction: TX } } };
  const r: any = await mk(async (_b: string, a: string[]) => { args = a; return { code: 0, stdout: JSON.stringify(okb) }; },
    { baseUrl: "https://passport.prod.gokite.ai", env: { KITE_X402_BODY: "{}", KITE_X402_METHOD: "POST" } })({ ...pay, amount: 0.001 });
  assert.equal(r.ok, true); assert.equal(r.network, "base"); assert.ok(args.includes("--body")); assert.ok(args.includes("https://passport.prod.gokite.ai"));
  const n: any = await mk(R(0, { ...ok, x402: { status_code: 200, chain_id: 8453, network: "eip155:8453" } }), { baseUrl: "https://passport.prod.gokite.ai" })(pay); assert.equal(n.ok, false); // prod: x402 chain fields alone are not trusted
});
test("failure persists redacted kpass stdout/stderr", async () => {
  const out = { status: "error", error_code: "merchant_rejected", message: "400 low/high required", agent_token: "eyJhbGciOiJ.abcdefghij.sig", private_key: "secretvalue" };
  const r: any = await mk(async () => ({ code: 2, stdout: JSON.stringify(out), stderr: "auth Bearer abc.def asr_ABCDEFGHIJKLMNOP" }))(pay);
  assert.equal(r.error, "merchant_rejected"); assert.match(r.detail, /low\/high required/);
  assert.doesNotMatch(r.detail, /secretvalue|eyJhbGciOiJ/); assert.doesNotMatch(r.stderr, /abc\.def|ABCDEFGHIJKLMNOP/);
  assert.equal(redact("x".repeat(9000)).length, 4000);
});
import { readFileSync } from "node:fs";
const FIX = JSON.parse(readFileSync(new URL("./fixtures/kpass-execute-prod-success.json", import.meta.url), "utf8"));
const P = { baseUrl: "https://passport.prod.gokite.ai" };
const clone = () => JSON.parse(JSON.stringify(FIX));
test("prod real execute shape (18:21 run): ok, Base tx, rng body with signature kept", async () => {
  const r: any = await mk(R(0, FIX), P)({ ...pay, amount: 0.001 });
  assert.equal(r.ok, true); assert.equal(r.chain_id, 8453); assert.equal(r.x402_chain_id, 2366);
  assert.equal(r.tx_id, "0xe152eed87817b84fdabbe84a3ca2efb3167179959d86f3d01a8fd1d9b35ff75c");
  const b = JSON.parse(r.merchant_body); assert.deepEqual(b.result, [12]); assert.match(b.signature, /^0x5a/); assert.equal(b.scheme, "eip191");
  assert.equal(r.spent_total, "0.002"); assert.ok(r.detail.length > 0);
});
test("prod fail closed on real shape: wrong network / success false / missing tx / chain_id only", async () => {
  const a = clone(); a.x402.payment_response.network = "eip155:137";
  const b = clone(); b.x402.payment_response.success = false;
  const c = clone(); delete c.x402.payment_response.transaction;
  const d = clone(); delete d.x402.payment_response; d.x402.chain_id = 8453;
  const e = clone(); e.x402.status_code = 500;
  const exp = ["unexpected_chain", "payment_not_successful", "no_tx_hash", "unexpected_chain", "merchant_http_500"];
  for (const [i, x] of [a, b, c, d, e].entries()) { const r: any = await mk(R(0, x), P)(pay); assert.equal(r.ok, false); assert.equal(r.error, exp[i]); assert.ok(r.detail.length > 0); }
});
test("redact keeps secrets out but merchant body keeps signature", async () => {
  const x = clone(); x.x402.parsed_response_body.agent_token = "eyJabcdefghijk.payload.sig";
  const r: any = await mk(R(0, x), P)(pay); assert.doesNotMatch(r.merchant_body + r.detail, /eyJabcdefghijk/); assert.match(r.merchant_body, /0x5a5a/);
});
