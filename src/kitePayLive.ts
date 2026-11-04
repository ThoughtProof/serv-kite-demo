// kite_pay LIVE (Kite Passport; allowlisted backends: dev/testnet and prod/Base). Selected only by KITE_PAY_MODE=LIVE; default stays MOCK.
// Calls `kpass agent:session execute --url $KITE_X402_URL` against the dev/testnet Passport backend.
// Fail closed: any error, non-zero exit, missing tx hash, non-allowlisted backend, unexpected chain -> {ok:false}; never a fake tx.
// Only reachable through Gate.execute after an ALLOW for the same action digest (executor.ts).
import { execFile } from "node:child_process";
import { homedir } from "node:os";

export const TESTNET_BASE_URL = "https://passport.dev.gokite.ai";
export const PROD_BASE_URL = "https://passport.prod.gokite.ai";
// Explicit allowlist: base URL -> expected settlement chain. Anything else fails closed.
export const ALLOWED_BASES: Record<string, { chains: number[]; allowX402ChainId: boolean; network: string; note: string }> = {
  [TESTNET_BASE_URL]: { chains: [2368], allowX402ChainId: true, network: "kite-testnet", note: "Kite Passport TESTNET payment (no real money)" },
  [PROD_BASE_URL]: { chains: [8453], allowX402ChainId: false, network: "base", note: "Kite Passport PRODUCTION payment (real USDC on Base)" },
};
export type Runner = (bin: string, args: string[], opts: { cwd?: string; timeoutMs: number }) => Promise<{ code: number; stdout: string; stderr?: string }>;

const defaultRunner: Runner = (bin, args, opts) => new Promise(res => {
  execFile(bin, args, { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 4 << 20 }, (err: any, stdout, stderr) =>
    res({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }));
});

// Redact anything secret-looking before persisting kpass output (JWTs, hex keys, tokens, signatures, auth headers).
export function redact(t: string, max = 4000): string {
  return String(t ?? "")
    .replace(/("(?:[^"]*(?:token|secret|private|key|signature|authorization|jwt|password)[^"]*)"\s*:\s*)"[^"]*"/gi, '$1"***"')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, "***jwt")
    .replace(/\b(asr|sk|pk|tok|key|dqlk|dqla|tp_op|tp_sent|serv)_[A-Za-z0-9_-]{8,}/g, "***")
    .replace(/\b(Bearer)\s+\S+/gi, "$1 ***")
    .replace(/0x[0-9a-fA-F]{65,}/g, "0x***")
    .slice(0, max);
}
// Merchant body: keep public signature/hash fields (they are the proof), strip only credential-like material.
export function redactMerchant(t: string, max = 4000): string {
  return String(t ?? "")
    .replace(/("(?:[^"]*(?:token|secret|private|api_?key|authorization|jwt|password)[^"]*)"\s*:\s*)"[^"]*"/gi, '$1"***"')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, "***jwt")
    .replace(/\b(Bearer)\s+\S+/gi, "$1 ***").slice(0, max);
}
export const isLive = (env = process.env) => env.KITE_PAY_MODE === "LIVE";

export function makeKitePayLive(o: { url?: string; baseUrl?: string; bin?: string; cwd?: string; maxPerTx?: number; runner?: Runner; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}) {
  const env = o.env ?? process.env;
  const url = o.url ?? env.KITE_X402_URL;
  const baseUrl = o.baseUrl ?? env.KITE_PASSPORT_BASE_URL ?? TESTNET_BASE_URL;
  const bin = o.bin ?? env.KPASS_BIN ?? `${homedir()}/.local/bin/kpass`;
  const cwd = o.cwd ?? env.KPASS_CWD; // dir holding .kite-passport/ (local install)
  const maxPerTx = o.maxPerTx ?? Number(env.KITE_MAX_PER_TX ?? "0.1");
  const run = o.runner ?? defaultRunner;
  let used = false;
  return async function kitePayLive(p: { amount: number; asset: string; recipient: string; purpose: string }) {
    const fail = (error: string, extra: object = {}) => ({ ok: false, mode: "LIVE", error, ...extra });
    if (!url) return fail("live_url_missing");
    if (!/^https:\/\//.test(url)) return fail("live_url_not_https");
    const target = Object.prototype.hasOwnProperty.call(ALLOWED_BASES, baseUrl) ? ALLOWED_BASES[baseUrl] : null;
    if (!target) return fail("live_base_url_not_allowlisted");
    if (!(p?.amount > 0) || !Number.isFinite(p.amount) || p.amount > maxPerTx) return fail("amount_invalid_or_over_cap");
    if (used) return fail("live_single_payment_per_run");
    used = true;
    let r;
    try { r = await run(bin, ["agent:session", "execute", "--url", url, "--method", env.KITE_X402_METHOD ?? "GET",
      ...(env.KITE_X402_BODY ? ["--body", env.KITE_X402_BODY] : []), ...(env.KITE_X402_HEADERS ? ["--headers", env.KITE_X402_HEADERS] : []), "--base-url", baseUrl, "--no-interactive", "--output", "json"], { cwd, timeoutMs: o.timeoutMs ?? 300_000 }); }
    catch { return fail("kpass_spawn_failed"); }
    let j: any;
    try { j = JSON.parse(r.stdout); } catch { return fail("kpass_output_unparseable", { exit: r.code, detail: redact(r.stdout), stderr: redact(r.stderr ?? "") }); }
    if (r.code !== 0 || j?.status !== "success") return fail(String(j?.error_code ?? "kpass_error"), { exit: r.code, detail: redact(r.stdout), stderr: redact(r.stderr ?? "") });
    const raw = { detail: redact(r.stdout), stderr: redact(r.stderr ?? "") };
    const pr = j?.x402?.payment_response;
    const tx = target.allowX402ChainId ? (j?.payment?.payment_response?.reference ?? j?.transaction_hash ?? j?.payment?.transaction_hash ?? pr?.transaction) : pr?.transaction;
    const http = j?.x402?.status_code;
    const mb = j?.x402?.parsed_response_body ?? j?.x402?.response_body ?? j?.x402?.body ?? null;
    const merchant_body = redactMerchant(typeof mb === "string" ? mb : JSON.stringify(mb));
    // Settlement chain: prod = x402.payment_response.network (CAIP-2) and success===true. x402.chain_id is the
    // Passport's own Kite chain (2366 on prod), NOT the settlement chain; only the testnet backend falls back to it.
    const net = typeof pr?.network === "string" && /^eip155:\d+$/.test(pr.network) ? Number(pr.network.split(":")[1]) : null;
    const cid = target.allowX402ChainId ? (net ?? j?.x402?.chain_id ?? null) : net;
    const txOk = typeof tx === "string" && /^0x[0-9a-fA-F]{64}$/.test(tx) ? tx : null;
    const base = { tx_id: txOk, chain_id: cid, x402_chain_id: j?.x402?.chain_id ?? null, merchant_body, spent_total: j?.usage?.spent_total ?? null, ...raw };
    if (!target.chains.includes(cid)) return fail("unexpected_chain", base);
    if (!target.allowX402ChainId && pr?.success !== true) return fail("payment_not_successful", base);
    if (!txOk) return fail("no_tx_hash", base);
    if (typeof http !== "number" || http < 200 || http >= 300) return fail("merchant_http_" + http, base);
    return { ok: true, mode: "LIVE", network: target.network, note: target.note, amount: j?.payment_requirement?.amount ?? null, ...base };
  };
}
