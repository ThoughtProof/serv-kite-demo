// Reusable gate: any side-effecting action executes only if a prior verify for the SAME action digest returned ALLOW.
import { createHash } from "node:crypto";
import type { VerifyResult } from "./thoughtproof.ts";

const canon = (v: any): string => v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",")}}`;
export const digest = (a: unknown) => createHash("sha256").update(canon(a)).digest("hex");

export class Gate {
  private allowed = new Set<string>();
  /** First verdict per action digest is binding for this run (no re-roll: a later verify can neither turn ALLOW into a fresh
   *  coin-flip nor turn BLOCK/UNCERTAIN into ALLOW). */
  private verdicts = new Map<string, VerifyResult>();
  recorded(action: unknown): VerifyResult | undefined { return this.verdicts.get(digest(action)); }
  record(action: unknown, r: VerifyResult) {
    const d = digest(action);
    if (this.verdicts.has(d)) return;
    this.verdicts.set(d, r);
    if (r.verdict === "ALLOW") this.allowed.add(d);
  }
  /** Consumes the ALLOW once (no replay of one verdict for two executions). */
  async execute<T>(action: unknown, fn: () => T | Promise<T>): Promise<T | { ok: false; error: "not_allowed_by_gate" }> {
    const d = digest(action);
    if (!this.allowed.has(d)) return { ok: false, error: "not_allowed_by_gate" };
    this.allowed.delete(d);
    return fn();
  }
}
