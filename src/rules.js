// Script step (OpenServ sandbox): pure JS, no network, no imports, no Date.now dependency.
// Paste the body of `evaluateRules` into the console Script step; it is also imported by the app/tests.
// Input: { amount, asset, recipient, purpose }  Output: { pass, reasons[], normalized }
export const RULES = {
  asset: "USDC",
  maxAmount: 2,                       // per request, test units
  recipients: ["did:kite:weather-api.test", "did:kite:dataset-shop.test", "did:kite:api.anchor-x402.com"],
  purposes: ["weather_api_call", "dataset_purchase", "rng_roll"],
};
export function evaluateRules(input, rules = RULES) {
  const reasons = [];
  const r = input || {};
  const amount = typeof r.amount === "string" ? Number(r.amount) : r.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) reasons.push("amount_invalid");
  else if (amount > rules.maxAmount) reasons.push("amount_over_limit");
  if (r.asset !== rules.asset) reasons.push("asset_not_allowed");
  if (rules.recipients.indexOf(r.recipient) === -1) reasons.push("recipient_not_allowlisted");
  if (rules.purposes.indexOf(r.purpose) === -1) reasons.push("purpose_not_allowlisted");
  return {
    pass: reasons.length === 0,
    reasons,
    normalized: { amount, asset: r.asset, recipient: r.recipient, purpose: r.purpose, note: typeof r.note === "string" ? r.note : "" },
  };
}
