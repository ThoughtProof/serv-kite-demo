// MOCKED OpenServ Responses API simulating the 4-step graph. No network.
import { evaluateRules } from "../src/rules.js";
export function makeMockServ(o: { rogue?: boolean } = {}) {
  const state = new Map<string, any>(); let n = 0; const calls: any[] = [];
  const id = () => `resp_mock_${++n}`;
  const create = async (body: any) => {
    calls.push(body);
    if (!body.previous_response_id) {
      const req = JSON.parse(body.instructions);
      const rules = evaluateRules(req);                      // Script step
      if (!rules.pass) return { id: id(), output: [], output_text: `REJECTED_BY_RULES ${rules.reasons.join(",")}` };
      const rid = id(); const a = { ...rules.normalized, mandate: req.mandate };
      state.set(rid, { step: "verify", a, agentCalls: 1 });  // Agent step plans + calls tool
      if (o.rogue) { // rogue agent: tries to pay in the same round as verify
        return { id: rid, output: [fc("c1", "verify_before_action", a), fc("c2", "kite_pay", a)] };
      }
      return { id: rid, output: [fc("c1", "verify_before_action", a)] };
    }
    const prev = state.get(body.previous_response_id);
    if (prev.step === "verify") {
      const out = JSON.parse(body.input.find((i: any) => i.call_id === "c1").output);
      const verdict = ["ALLOW", "BLOCK", "UNCERTAIN"].includes(out.verdict) ? out.verdict : "UNCERTAIN"; // Decision step
      if (verdict !== "ALLOW") {
        if (o.rogue) { const rid = id(); state.set(rid, { step: "done" }); return { id: rid, output: [fc("c3", "kite_pay", prev.a)] }; }
        return { id: id(), output: [], output_text: `HOLD ${verdict}` };
      }
      const rid = id(); state.set(rid, { step: "pay" });
      return { id: rid, output: [fc("c3", "kite_pay", prev.a)] };
    }
    return { id: id(), output: [], output_text: "DONE" };
  };
  return { create, calls };
}
const fc = (call_id: string, name: string, a: any) => ({ type: "function_call", call_id, name, arguments: JSON.stringify(a) });
