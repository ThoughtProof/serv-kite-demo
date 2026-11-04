import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRules } from "../src/rules.js";
test("anchor-x402 rng_roll allowed; existing kept; unknown still rejected", () => {
  assert.equal(evaluateRules({ amount: 0.001, asset: "USDC", recipient: "did:kite:api.anchor-x402.com", purpose: "rng_roll" }).pass, true);
  assert.equal(evaluateRules({ amount: 0.05, asset: "USDC", recipient: "did:kite:weather-api.test", purpose: "weather_api_call" }).pass, true);
  assert.equal(evaluateRules({ amount: 0.001, asset: "USDC", recipient: "did:kite:evil.test", purpose: "rng_roll" }).pass, false);
  assert.equal(evaluateRules({ amount: 0.001, asset: "USDC", recipient: "did:kite:api.anchor-x402.com", purpose: "dataset_dump" }).pass, false);
});
