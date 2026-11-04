// LIVE run: real OpenServ graph (model=gr_...), ThoughtProof real if THOUGHTPROOF_API_KEY set else MOCK (labeled), Kite always MOCK.
// Exactly one run per scenario, no retries.
import { readFileSync, writeFileSync } from "node:fs";
import { runGraph } from "../src/executor.ts";
import { createSession, makeKitePay } from "../src/kitePay.ts";
import { makeServClient } from "../src/servClient.ts";
import { makeThoughtProofVerifier } from "../src/thoughtproof.ts";
import { sentinelBody } from "../src/sentinelBody.ts";
import { existsSync } from "node:fs";
const GRAPH = process.argv[2] ?? "gr_df01264afea66dfc";
const sc = JSON.parse(readFileSync(new URL("../scenarios/scenarios.json", import.meta.url), "utf8"));
const KEYFILE = new URL("../.secrets/grokbot-sentinel-key", import.meta.url);
const tpKey = existsSync(KEYFILE) ? readFileSync(KEYFILE, "utf8").trim() : "";
const tpLive = !!tpKey;
console.log(`graph=${GRAPH} thoughtproof=${tpLive ? "LIVE" : "MOCK (no key file)"} kite=MOCK`);
const create = makeServClient();
const results: any[] = [];
const only = (process.env.ONLY ?? "").split(",").filter(Boolean);
for (const s of sc.filter((x: any) => !only.length || only.includes(x.id))) {
  const session = createSession({ maxPerTx: 2, maxTotal: 10, ttlMs: 86_400_000, scope: ["did:kite:weather-api.test", "did:kite:dataset-shop.test"] });
  const verify = tpLive ? makeThoughtProofVerifier({ apiKey: tpKey, keyHeader: "X-Sentinel-Key", buildBody: sentinelBody, timeoutMs: 60_000 }) : async () => ({ verdict: s.mockVerdict, reason: "MOCK ThoughtProof (not live)" });
  try {
    const r: any = await runGraph({ graphId: GRAPH, request: s.request, create, verify, kitePay: makeKitePay(session) });
    results.push({ id: s.id, expect: s.expect, reachedGraph: r.reachedGraph, executed: r.executed, verdict: r.lastVerdict, rounds: r.rounds, final: r.final, usage: r.usage, tools: r.audit.filter((a: any) => a.event === "tool").map((a: any) => ({ name: a.name, result: a.result })) });
  } catch (e: any) { results.push({ id: s.id, expect: s.expect, error: String(e?.message ?? e) }); }
  console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(process.env.OUT ?? "live-results.json", JSON.stringify(results, null, 2));
