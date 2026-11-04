// ThoughtProof verify_before_action adapter. Fail-safe: anything but a clean ALLOW is treated as not-allowed.
// Key only from env THOUGHTPROOF_API_KEY; never logged.
export type Verdict = "ALLOW" | "BLOCK" | "UNCERTAIN";
export interface VerifyResult { verdict: Verdict; reason: string; receipt_id?: string; http_status?: number; gate?: any; confidence?: number; models_used?: string[]; duration_ms?: number }
export type FetchLike = (url: string, init: any) => Promise<{ status: number; json(): Promise<any> }>;

export function makeThoughtProofVerifier(opts: {
  fetch?: FetchLike; url?: string; timeoutMs?: number; apiKey?: string; keyHeader?: string; buildBody?: (a: { mandate: string; action: any; granted?: any; appPayment?: any; appEvidence?: string[] }) => unknown;
} = {}) {
  const url = opts.url ?? process.env.THOUGHTPROOF_VERIFY_URL ?? "https://sentinel.thoughtproof.ai/sentinel/verify";
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const f = opts.fetch ?? (globalThis.fetch as any);
  return async function verify(action: { mandate: string; action: unknown; granted?: unknown; appPayment?: unknown; appEvidence?: unknown }): Promise<VerifyResult> {
    const key = opts.apiKey ?? process.env.THOUGHTPROOF_API_KEY;
    if (!key) return { verdict: "UNCERTAIN", reason: "no_api_key_configured" };
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await Promise.race([
        f(url, { method: "POST", signal: ac.signal,
          headers: { "content-type": "application/json", ...(opts.keyHeader ? { [opts.keyHeader]: key } : { authorization: `Bearer ${key}` }) },
          body: JSON.stringify(opts.buildBody ? opts.buildBody(action) : action) }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
      ]);
      if (res.status !== 200) return { verdict: "UNCERTAIN", reason: `http_${res.status}`, http_status: res.status };
      const body = await res.json();
      const v = body?.verdict;
      if (v === "ALLOW" || v === "BLOCK") return { verdict: v, reason: String(body.reasoning ?? body.reason ?? "").slice(0, 600), gate: body.gate ? { mode: body.gate.mode, wouldBlock: body.gate.wouldBlock, enforced: body.gate.enforced, violations: (body.gate.violations ?? []).map((x: any) => x.type ?? x.kind) } : undefined, confidence: body.confidence, models_used: body.meta?.models_used, duration_ms: body.meta?.duration_ms, receipt_id: body.receipt_id ?? body.id, http_status: 200 };
      return { verdict: "UNCERTAIN", reason: v === "UNCERTAIN" ? "sentinel_uncertain: " + String(body.reasoning ?? body.reason ?? "").slice(0, 400) : "unrecognized_verdict", receipt_id: body?.receipt_id ?? body?.id, http_status: 200 };
    } catch (e: any) {
      return { verdict: "UNCERTAIN", reason: e?.message === "timeout" || e?.name === "AbortError" ? "timeout" : "error" };
    } finally { clearTimeout(t); }
  };
}
