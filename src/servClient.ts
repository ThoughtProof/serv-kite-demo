// Minimal OpenServ Responses client. Key only from env SERV_API_KEY (never logged).
export type FetchLike = (url: string, init: any) => Promise<{ status: number; json(): Promise<any> }>;
export function makeServClient(opts: { fetch?: FetchLike; baseUrl?: string; apiKey?: string } = {}) {
  const base = opts.baseUrl ?? "https://inference-api.openserv.ai/v1/responses";
  const f = opts.fetch ?? (globalThis.fetch as any);
  return async function create(body: Record<string, unknown>) {
    const key = opts.apiKey ?? process.env.SERV_API_KEY;
    if (!key) throw new Error("SERV_API_KEY not set");
    const res = await f(base, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ ...body, stream: false }) });
    if (res.status !== 200) { const rid = (res as any).headers?.get?.("x-openserv-request-id") ?? "-"; let m = ""; try { const b: any = await res.json(); m = String(b?.error?.message ?? "").slice(0, 300); } catch {} throw new Error(`openserv_http_${res.status} request_id=${rid} ${m}`); }
    const j: any = await res.json(); j._request_id = (res as any).headers?.get?.("x-openserv-request-id") ?? null; return j;
  };
}
