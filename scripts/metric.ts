// Savings metric = 1 - (agent calls / requests) over N synthetic requests. Offline; uses the same Script-step rules.
// Agent step is only visited when the rules pass. Result depends entirely on the synthetic mix (stated in output).
import { evaluateRules } from "../src/rules.js";
const N = Number(process.argv[2] ?? 100);
const mix = { allowed: 0.6, forbidden: 0.25, edge: 0.15 };
let seed = Number(process.argv[3] ?? 42);
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const ok = ["did:kite:weather-api.test", "did:kite:dataset-shop.test"];
function synth(i: number) {
  const x = i / N;
  if (x < mix.allowed) return { amount: +(0.01 + rnd() * 0.5).toFixed(2), asset: "USDC", recipient: ok[i % 2], purpose: i % 2 ? "dataset_purchase" : "weather_api_call" };
  if (x < mix.allowed + mix.forbidden) return [
    { amount: 5, asset: "USDC", recipient: ok[0], purpose: "weather_api_call" },
    { amount: 0.05, asset: "USDC", recipient: "did:kite:evil.test", purpose: "weather_api_call" },
    { amount: 0.05, asset: "ETH", recipient: ok[0], purpose: "weather_api_call" },
    { amount: 0.05, asset: "USDC", recipient: ok[1], purpose: "gift" } ][i % 4];
  return { amount: +(1 + rnd()).toFixed(2), asset: "USDC", recipient: ok[1], purpose: "dataset_purchase" }; // edge: high but within limit
}
let agentCalls = 0;
for (let i = 0; i < N; i++) if (evaluateRules(synth(i)).pass) agentCalls++;
const savings = 1 - agentCalls / N;
console.log(JSON.stringify({ requests: N, agent_calls: agentCalls, savings: +savings.toFixed(4),
  baseline: "naive agent = 1 LLM call per request", mix, note: "synthetic mix; result depends on it. Offline count, not an OpenServ run." }, null, 2));
