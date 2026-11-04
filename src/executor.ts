// Tool-executor loop: starts a graph run, answers function_call items with function_call_output via previous_response_id.
import { evaluateRules } from "./rules.js";
import { Gate } from "./gate.ts";
import type { VerifyResult } from "./thoughtproof.ts";

export const MAX_TOOL_ROUNDS = 10;
export const DEFAULT_RUN_TIMEOUT_MS = 240_000;

export async function runGraph(p: {
  graphId: string; request: any; create: (b: any) => Promise<any>;
  verify: (a: any) => Promise<VerifyResult>; kitePay: (pay: any) => any; log?: (e: any) => void; runTimeoutMs?: number;
}) {
  const gate = new Gate();
  const audit: any[] = [];
  const log = (e: any) => { audit.push(e); p.log?.(e); };
  // Defense in depth: app re-applies the Script-step rules before any tool runs.
  // v3: the graph has no rules Script node, so the app runs the rules FIRST and only calls the graph on pass.
  const appRules = evaluateRules(p.request);
  const model = p.graphId.startsWith("gr_") ? p.graphId : `gr_${p.graphId}`;
  const usage: any[] = [];
  if (!appRules.pass) {
    log({ event: "rules", pass: false, reasons: appRules.reasons });
    return { executed: false, lastVerdict: null, rounds: 0, final: `REJECTED_BY_RULES ${appRules.reasons.join(",")}`, audit, usage, reachedGraph: false };
  }
  const track = (r: any) => { usage.push({ id: r?.id ?? null, request_id: r?._request_id ?? null, status: r?.status ?? null, usage: r?.usage ?? null, meta: Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => !["output","usage","instructions","tools"].includes(k))), output_types: (r?.output ?? []).map((o: any) => o.type + (o.name ? ":" + o.name : "")) }); return r; };
  const t0 = Date.now(); const deadline = p.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  let res = track(await p.create({ model, instructions: JSON.stringify(runInput(p.request)), tools: TOOLS }));
  let rounds = 0; let executed = false; let lastVerdict: string | null = null;
  while (true) {
    const calls = (res.output ?? []).filter((o: any) => o.type === "function_call");
    if (calls.length === 0) break;
    if (++rounds > MAX_TOOL_ROUNDS) { log({ event: "abort", reason: "tool_round_limit" }); break; }
    const outputs = [];
    for (const c of calls) {
      let args: any; try { args = JSON.parse(c.arguments ?? "{}"); } catch { args = null; }
      let out: any;
      if (!args) out = { ok: false, error: "bad_arguments" };
      else if (c.name === "verify_before_action") {
        if (!appRules.pass) out = { verdict: "BLOCK", reason: "app_rules:" + appRules.reasons.join(",") };
        else {
          const action = paymentOf(args);
          // Root-cause fix: the graph sometimes calls verify_before_action a 2nd time for the SAME payment (e.g. the
          // execute_payment agent re-checks). Each call used to be a fresh, nondeterministic Sentinel run whose result
          // overwrote the first ALLOW in the graph's context (-> no kite_pay, tx_id null) and doubled latency (-> run_timeout).
          // Now the first verdict for a payment digest is binding and replayed; never re-rolled (also blocks verdict shopping).
          const prior = gate.recorded(action);
          const r = prior ?? await p.verify({ mandate: String(args.mandate ?? ""), action: { kind: "value_transfer", ...action }, granted: p.request.granted, appPayment: paymentOf(p.request), ...(Array.isArray(p.request.evidence) ? { appEvidence: p.request.evidence.map(String) } : {}) });
          if (prior) log({ event: "verify_replayed", verdict: prior.verdict });
          gate.record(action, r); lastVerdict = r.verdict; out = r;
        }
      } else if (c.name === "kite_pay") {
        const action = paymentOf(args);
        out = await gate.execute(action, () => p.kitePay(action));
        if ((out as any).ok) executed = true;
      } else out = { ok: false, error: "unknown_tool" };
      log({ event: "tool", name: c.name, call_id: c.call_id, args, result: out });
      outputs.push({ type: "function_call_output", call_id: c.call_id, output: JSON.stringify(out) });
    }
    // Stale-run guard: never resume past the deadline; a failed resume is ERROR (HOLD), never a payment.
    if (Date.now() - t0 > deadline) { log({ event: "abort", reason: "run_timeout" }); return { executed, lastVerdict, rounds, final: "ERROR run_timeout", audit, usage, reachedGraph: true, error: "run_timeout" }; }
    try { res = track(await p.create({ model, previous_response_id: res.id, input: outputs, tools: TOOLS })); }
    catch (e: any) { const m = String(e?.message ?? e).slice(0, 200); log({ event: "abort", reason: m }); return { executed, lastVerdict, rounds, final: `ERROR ${m}`, audit, usage, reachedGraph: true, error: /not waiting for tool outputs/i.test(m) ? "stale_run" : m }; }
  }
  return { executed, lastVerdict, rounds, final: res.output_text ?? null, audit, usage, reachedGraph: true };
}
const paymentOf = (a: any) => ({ amount: Number(a.amount), asset: a.asset, recipient: a.recipient, purpose: a.purpose });

const runInput = (r: any) => ({ amount: r.amount, asset: r.asset, recipient: r.recipient, purpose: r.purpose, mandate: r.mandate });
const num = { type: "number" }, str = { type: "string" };
const KITE_DESC = process.env.KITE_PAY_MODE === "LIVE" ? "Kite payment via Kite Passport (LIVE); returns {tx_id, mode}" : "Kite payment (MOCK); returns {tx_id, mode}";
export const TOOLS = [
  { type: "function", name: "verify_before_action", description: "ThoughtProof gate; returns {verdict}", parameters: { type: "object", additionalProperties: false, required: ["mandate","amount","asset","recipient","purpose"], properties: { mandate: str, amount: num, asset: str, recipient: str, purpose: str } } },
  { type: "function", name: "kite_pay", description: KITE_DESC, parameters: { type: "object", additionalProperties: false, required: ["amount","asset","recipient","purpose"], properties: { amount: num, asset: str, recipient: str, purpose: str } } },
];
