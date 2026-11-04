// Runs the 4 scenarios against MOCKED OpenServ + MOCKED ThoughtProof. No network, no keys.
import { readFileSync } from "node:fs";
import { runGraph } from "../src/executor.ts";
import { createSession, makeKitePay } from "../src/kitePay.ts";
import { makeMockServ } from "../test/mockServ.ts";
const sc = JSON.parse(readFileSync(new URL("../scenarios/scenarios.json", import.meta.url), "utf8"));
for (const s of sc) {
  const session = createSession({ maxPerTx: 2, maxTotal: 10, ttlMs: 86_400_000, scope: ["did:kite:weather-api.test", "did:kite:dataset-shop.test"] });
  const r = await runGraph({ graphId: "MOCK", request: s.request, create: makeMockServ().create,
    verify: async () => ({ verdict: s.mockVerdict, reason: "MOCK verify" }), kitePay: makeKitePay(session) });
  const got = r.executed ? "EXECUTED" : String(r.final ?? "").split(" ")[0];
  console.log(`${s.id}: ${got} (expected ${s.expect}) verdict=${r.lastVerdict ?? "-"} ${got === s.expect ? "OK" : "MISMATCH"}`);
}
