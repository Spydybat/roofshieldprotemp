"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, CheckCircle2, XCircle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type Verdict = "PASS" | "FAIL" | "BLOCKED";

interface EventResult {
  event: string;
  verdict: Verdict;
  localCount: number;
  lastFiredAt: string | null;
  pixelPresent: boolean;
  forwardedToWhopApi: boolean;
  detail: string;
}

interface VerifyResponse {
  ok: boolean;
  checkedAt: string;
  credentials: {
    apiKey: boolean;
    accountId: boolean;
    accountIdValue: string | null;
    productId: string | null;
    eventsApiReadable: boolean;
    eventsApiError: string | null;
  };
  leads: {
    verdict: Verdict;
    detail: string;
    latestLeadId: string | null;
    latestLeadAt: string | null;
    totalCreated: number;
  };
  events: EventResult[];
}

function VerdictPill({ verdict }: { verdict: Verdict }) {
  const map = {
    PASS: { cls: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: CheckCircle2 },
    FAIL: { cls: "bg-red-100 text-red-800 border-red-200", icon: XCircle },
    BLOCKED: { cls: "bg-amber-100 text-amber-900 border-amber-300", icon: ShieldAlert },
  } as const;
  const { cls, icon: Icon } = map[verdict];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em]", cls)}>
      <Icon className="h-3.5 w-3.5" /> {verdict}
    </span>
  );
}

/**
 * Live verification of the Leads API and the three custom tracking events.
 * Every verdict is produced by asking Whop (retrieve lead / list events) —
 * this component never assumes success.
 */
export default function VerificationPanel() {
  const [data, setData] = useState<VerifyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/verify", { cache: "no-store" });
      if (!res.ok) throw new Error(`Verify endpoint returned HTTP ${res.status}`);
      setData((await res.json()) as VerifyResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not run verification.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-[1.75rem] border border-line bg-white p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl uppercase tracking-wide">Leads &amp; tracking verification</h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-mute">
            Each verdict comes from querying Whop directly — the stored lead is re-read with
            <code className="mx-1 rounded bg-paper px-1 py-0.5 font-mono text-[11px]">leads.retrieve</code>
            and events are looked up with
            <code className="mx-1 rounded bg-paper px-1 py-0.5 font-mono text-[11px]">events.list</code>.
            Absent credentials always yield BLOCKED, never PASS.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Re-run verification
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">{error}</p>
      )}

      {loading && !data && (
        <p className="mt-6 flex items-center gap-2 text-xs text-mute">
          <Loader2 className="h-4 w-4 animate-spin text-copper" /> Asking Whop…
        </p>
      )}

      {data && (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-[11px] text-mute">
            <VerdictPill verdict={data.credentials.apiKey && data.credentials.accountId ? "PASS" : "BLOCKED"} />
            <span>
              credentials: API key {data.credentials.apiKey ? "present" : "missing"} · account{" "}
              {data.credentials.accountIdValue ?? "missing"}
              {data.credentials.productId ? ` · product ${data.credentials.productId}` : ""}
            </span>
            <span className="ml-auto">checked {new Date(data.checkedAt).toLocaleTimeString()}</span>
          </div>

          {/* Leads */}
          <div className="mt-5 rounded-2xl border border-line bg-paper p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Whop Leads API — real lead creation</p>
                <p className="mt-1 text-[11px] leading-relaxed text-mute">{data.leads.detail}</p>
              </div>
              <VerdictPill verdict={data.leads.verdict} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] text-mute">
              <span>created: {data.leads.totalCreated}</span>
              <span>latest: {data.leads.latestLeadId ?? "—"}</span>
              <span>{data.leads.latestLeadAt ? new Date(data.leads.latestLeadAt).toLocaleString() : ""}</span>
            </div>
          </div>

          {/* Events */}
          <ul className="mt-4 space-y-3">
            {data.events.map((ev) => (
              <li key={ev.event} className="rounded-2xl border border-line bg-paper p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-xs font-semibold text-ink">{ev.event}</p>
                  <VerdictPill verdict={ev.verdict} />
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-mute">{ev.detail}</p>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] text-mute">
                  <span>fired: {ev.localCount}</span>
                  <span>pixel: {ev.pixelPresent ? "yes" : "no"}</span>
                  <span>whop api: {ev.forwardedToWhopApi ? "forwarded" : "not forwarded"}</span>
                  {ev.lastFiredAt && <span>{new Date(ev.lastFiredAt).toLocaleString()}</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
