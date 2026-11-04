// kite_pay: Kite-Passport-style spending session (max per tx, max total, TTL, scope).
// MOCK ONLY: no chain, no wallet, no funds. Every result is labeled mode:"MOCK".
export interface Session { id: string; maxPerTx: number; maxTotal: number; expiresAt: number; scope: string[]; spent: number; asset: string }
export interface Payment { amount: number; asset: string; recipient: string; purpose: string }

export function createSession(p: { maxPerTx: number; maxTotal: number; ttlMs: number; scope: string[]; asset?: string; now?: number }): Session {
  const now = p.now ?? Date.now();
  return { id: `mock-session-${now}`, maxPerTx: p.maxPerTx, maxTotal: p.maxTotal, expiresAt: now + p.ttlMs, scope: [...p.scope], spent: 0, asset: p.asset ?? "USDC" };
}

export function makeKitePay(session: Session, clock: () => number = Date.now) {
  let n = 0;
  return function kitePay(p: Payment) {
    if (clock() >= session.expiresAt) return { ok: false, mode: "MOCK", error: "session_expired" };
    if (!session.scope.includes(p.recipient)) return { ok: false, mode: "MOCK", error: "session_scope_forbidden" };
    if (p.asset !== session.asset) return { ok: false, mode: "MOCK", error: "asset_forbidden" };
    if (!(p.amount > 0) || !Number.isFinite(p.amount)) return { ok: false, mode: "MOCK", error: "amount_invalid" };
    if (p.amount > session.maxPerTx) return { ok: false, mode: "MOCK", error: "max_per_tx_exceeded" };
    if (session.spent + p.amount > session.maxTotal + 1e-9) return { ok: false, mode: "MOCK", error: "max_total_exceeded" };
    session.spent = Math.round((session.spent + p.amount) * 1e6) / 1e6;
    return { ok: true, mode: "MOCK", tx_id: `MOCK-TX-${++n}`, note: "MOCK payment, no funds moved", remaining: session.maxTotal - session.spent };
  };
}
