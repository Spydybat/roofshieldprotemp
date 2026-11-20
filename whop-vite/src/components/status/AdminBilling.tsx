"use client";

import { useState } from "react";
import { Loader2, AlertTriangle, FileCheck2, Lock } from "lucide-react";
import { formatUsd, cn } from "@/lib/utils";

export interface ProjectRow {
  id: string;
  email: string | null;
  memberId: string | null;
  hasCard: boolean;
  status: string;
  depositCents: number;
  createdAt: string;
}

/**
 * Demo admin console for the final-balance step of the documented flow:
 * deposit paid → project associated → invoice for the balance, either
 * auto-charged to the consented card on file or emailed for manual payment.
 * Protected by ADMIN_TOKEN (x-admin-token header).
 */
export default function AdminBilling({ projects }: { projects: ProjectRow[] }) {
  const [token, setToken] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [total, setTotal] = useState("9500");
  const [method, setMethod] = useState<"auto" | "manual">("manual");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const project = projects.find((p) => p.id === projectId);

  async function createInvoice() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({
          projectId: projectId || undefined,
          email: email || project?.email || undefined,
          customerName: name || undefined,
          contractTotalUsd: Number(total),
          method,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setResult({ ok: false, text: data.message ?? data.code ?? "Invoice creation failed." });
      } else {
        setResult({
          ok: true,
          text: `Invoice ${data.invoiceId} · Whop status: ${data.whopStatus} · balance ${formatUsd(Math.round(data.balanceUsd * 100))} · ${data.collectionMethod}`,
        });
      }
    } catch {
      setResult({ ok: false, text: "Network error creating the invoice." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[1.75rem] border border-line bg-white p-6 sm:p-8">
      <h3 className="font-display text-2xl uppercase tracking-wide text-ink">
        Final-Balance Invoicing <span className="text-copper">(Admin Demo)</span>
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-mute">
        Demonstrates the official Whop Invoices API: bill the remaining balance of a deposit-backed
        project by auto-charging the card saved with consent (setup intent) or emailing a pay link.
        Requires <code className="rounded bg-paper px-1.5 py-0.5 text-xs">ADMIN_TOKEN</code>.
      </p>

      <div className="mt-6 grid gap-4">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
            Admin token
          </span>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-white px-4 focus-within:border-copper">
            <Lock className="h-4 w-4 text-mute" />
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="x-admin-token"
              className="w-full bg-transparent py-3 text-sm outline-none"
            />
          </div>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
              Project (deposit on file)
            </span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="field"
            >
              <option value="">— No project (email-only) —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.email ?? p.memberId ?? p.id.slice(0, 8)} · {p.status}
                  {p.hasCard ? " · card on file" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
              Contract total (USD)
            </span>
            <input
              value={total}
              onChange={(e) => setTotal(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              className="field"
              placeholder="9500"
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
              Customer email (for manual invoices)
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
              placeholder="customer@example.com"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
              Customer name
            </span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="field" placeholder="Jordan Miller" />
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
            Collection method
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMethod("auto")}
              className={cn(
                "rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                method === "auto" ? "border-copper bg-copper/10" : "border-line",
              )}
            >
              <strong className="block text-ink">Auto-charge card on file</strong>
              <span className="text-xs text-mute">charge_automatically with the saved payt_ method</span>
            </button>
            <button
              type="button"
              onClick={() => setMethod("manual")}
              className={cn(
                "rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                method === "manual" ? "border-copper bg-copper/10" : "border-line",
              )}
            >
              <strong className="block text-ink">Email pay link</strong>
              <span className="text-xs text-mute">send_invoice — customer pays manually</span>
            </button>
          </div>
          {method === "auto" && project && !project.hasCard && (
            <p className="mt-2 text-xs text-amber-700">
              The selected project has no saved card — the API call will return an honest error.
            </p>
          )}
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
            Notes (shown on the invoice line)
          </span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="field" placeholder="Architectural shingle replacement — 32 squares" />
        </label>

        <button
          onClick={createInvoice}
          disabled={busy || !token}
          className="btn-lux flex items-center justify-center gap-2 rounded-full bg-ink py-3.5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ ["--btn-sweep" as string]: "#b77a4b" }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
          Create invoice via Whop
        </button>

        {result && (
          <div
            className={cn(
              "flex items-start gap-2.5 rounded-2xl border p-4 text-sm",
              result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800",
            )}
          >
            {result.ok ? <CheckIcon /> : <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0" />}
            <span>{result.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function CheckIcon() {
  return <FileCheck2 className="mt-0.5 h-4.5 w-4.5 shrink-0" />;
}
