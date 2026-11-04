// Body for POST /sentinel/verify. Schema: https://sentinel.thoughtproof.ai/api/openapi + thoughtproof-sentinel
// src/types.ts (SentinelVerifyRequest) and src/engine/authorization-gate.ts (AuthorizationMandate):
//   mandate.granted {maxAmount?, asset?, recipient?, allowUnlimited?}, mandate.action {kind?, amount?, asset?, recipient?, allowance?}.
// granted comes from the APP request (principal's structured grant), never from the LLM tool call.
// gateMode: 'enforce' (Raul GO 28.10 21:21): a deterministic gate violation hard-BLOCKs. Server default would be 'shadow'.
// appEvidence: app-supplied facts for mandate conditions (e.g. delivery/checksum), from the APP request only.
// Evidence names the concrete payment from the APP request (appPayment), never from the model's tool call.
export function sentinelBody(a: { mandate: string; action: any; granted?: any; appPayment?: any; appEvidence?: string[] }) {
  const x = a.action;
  const mandate: any = { kind: "value_transfer", action: { kind: "value_transfer", amount: x.amount, asset: x.asset, recipient: x.recipient } };
  if (a.granted) mandate.granted = { maxAmount: a.granted.maxAmount, asset: a.granted.asset, recipient: a.granted.recipient, allowUnlimited: false };
  return {
    claim: `Pay ${x.amount} ${x.asset} to ${x.recipient} for purpose "${x.purpose}".`,
    evidence: [
      `Principal mandate (verbatim): ${a.mandate}`,
      ...(a.appEvidence ?? []).map((e) => `App-supplied evidence (from the app, not the model): ${e}`),
      a.appPayment ? `Concrete payment requested by the app: amount=${a.appPayment.amount} asset=${a.appPayment.asset} recipient=${a.appPayment.recipient} purpose=${a.appPayment.purpose}.` : "",
    ].filter(Boolean).join("\n"),
    mode: "action_authorization", tier: "standard", gateMode: "enforce", mandate,
    agent_context: { agent_runtime: "openserv-graph", environment: "dev", tags: ["serv-kite-demo"] },
  };
}
