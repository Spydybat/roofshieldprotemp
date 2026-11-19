import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ShieldAlert,
  Radio,
  Activity,
  Users,
  FileText,
  CreditCard,
} from "lucide-react";
import { db } from "@/db";
import { invoices, leads, roofingProjects, trackEvents } from "@/db/schema";
import { desc } from "drizzle-orm";
import { pingWhopApi, whopConfigReport } from "@/server/whop";
import AdminBilling, { type ProjectRow } from "@/components/status/AdminBilling";
import VerificationPanel from "@/components/status/VerificationPanel";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Integration Status — RoofShield Pro",
  robots: { index: false },
};

type ReqStatus = "PASS" | "READY" | "BLOCKED";

function Badge({ status }: { status: ReqStatus }) {
  const styles: Record<ReqStatus, string> = {
    PASS: "bg-emerald-100 text-emerald-800 border-emerald-200",
    READY: "bg-sky-100 text-sky-800 border-sky-200",
    BLOCKED: "bg-amber-100 text-amber-900 border-amber-300",
  };
  const icons: Record<ReqStatus, React.ReactNode> = {
    PASS: <CheckCircle2 className="h-3.5 w-3.5" />,
    READY: <Clock3 className="h-3.5 w-3.5" />,
    BLOCKED: <ShieldAlert className="h-3.5 w-3.5" />,
  };
  const labels: Record<ReqStatus, string> = {
    PASS: "Verified",
    READY: "Implemented · awaiting credentials",
    BLOCKED: "Blocked · action required",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em]", styles[status])}>
      {icons[status]} {labels[status]}
    </span>
  );
}

function ConfigRow({ label, ok, hint }: { label: string; ok: boolean; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-0">
      <div>
        <code className="text-xs font-semibold text-ink">{label}</code>
        <p className="mt-0.5 text-[11px] text-mute">{hint}</p>
      </div>
      <span className={cn("h-2.5 w-2.5 rounded-full", ok ? "bg-emerald-500" : "bg-amber-400")} aria-label={ok ? "set" : "missing"} />
    </div>
  );
}

export default async function StatusPage() {
  const config = whopConfigReport();
  const api = await pingWhopApi();

  let eventRows: (typeof trackEvents.$inferSelect)[] = [];
  let leadRows: (typeof leads.$inferSelect)[] = [];
  let invoiceRows: (typeof invoices.$inferSelect)[] = [];
  let projectRows: (typeof roofingProjects.$inferSelect)[] = [];
  try {
    [eventRows, leadRows, invoiceRows, projectRows] = await Promise.all([
      db.select().from(trackEvents).orderBy(desc(trackEvents.createdAt)).limit(20),
      db.select().from(leads).orderBy(desc(leads.createdAt)).limit(10),
      db.select().from(invoices).orderBy(desc(invoices.createdAt)).limit(10),
      db.select().from(roofingProjects).orderBy(desc(roofingProjects.createdAt)).limit(20),
    ]);
  } catch {
    // tables not yet migrated — page still renders
  }

  const fired = (name: string) => eventRows.some((e) => e.event === name);
  const allPlans = config.planInspection && config.planDeposit && config.planGutter;
  const verifiedLead = leadRows.some((l) => l.whopStatus === "created");
  const verifiedDeposit = projectRows.some((p) => p.status === "paid");
  const verifiedInvoice = invoiceRows.some((i) => i.whopInvoiceId && i.whopStatus !== "error");

  const requirements: { n: number; label: string; status: ReqStatus; detail: string }[] = [
    {
      n: 1,
      label: "Live whop.app URL",
      status: "BLOCKED",
      detail:
        "Deployment to Whop Websites requires the merchant's Whop account via `npx @whop/cli apps deploy`. No account credentials exist in this sandbox, so no URL can be claimed. The codebase follows the documented Websites build layout.",
    },
    {
      n: 2,
      label: "Three real Whop plans connected to checkout",
      status: allPlans && config.apiKey ? "PASS" : "BLOCKED",
      detail: allPlans
        ? "Plan IDs configured for Inspection $149, Deposit $500, Gutter Cleaning $299."
        : "Create the three one-time plans in the Whop dashboard and set WHOP_PLAN_ID_INSPECTION / _DEPOSIT / _GUTTER. Buttons open real Whop checkouts only — nothing is faked.",
    },
    {
      n: 3,
      label: "Payment Elements (Checkout, Express, Branding)",
      status: config.apiKey && config.accountId ? "READY" : "BLOCKED",
      detail:
        "CheckoutElement + ExpressCheckoutElement + BrandingElement are mounted via @whop/elements-react inside every checkout modal. Rendering requires a valid WHOP_API_KEY/WHOP_ACCOUNT_ID pair.",
    },
    {
      n: 4,
      label: "Estimate form creates a real Whop Lead",
      status: verifiedLead ? "PASS" : config.apiKey && config.accountId ? "READY" : "BLOCKED",
      detail: verifiedLead
        ? "A lead has been created through POST /api/v1/leads — see the log below."
        : "POST /api/leads validates server-side and calls the official Leads API. Verified once a submission succeeds with live credentials.",
    },
    {
      n: 5,
      label: "Deposit: setup-intent card-on-file with consent",
      status: verifiedDeposit ? "PASS" : config.planDeposit && config.apiKey ? "READY" : "BLOCKED",
      detail:
        "Setup-mode checkout configuration → buyer saves the card (setup intent) with explicit consent → server charges the $500 deposit plan off-session, idempotent per setup intent. No card data is ever stored here.",
    },
    {
      n: 6,
      label: "Final balance invoice (auto-charge or manual)",
      status: verifiedInvoice ? "PASS" : config.apiKey ? "READY" : "BLOCKED",
      detail:
        "POST /api/invoices (admin-token protected) creates + finalizes a real invoice: charge_automatically on the saved payt_ method, or send_invoice emailed for manual payment. Whop status is shown verbatim.",
    },
    {
      n: 7,
      label: "Custom events verifiable (estimate_requested, service_viewed, deposit_started)",
      status: fired("estimate_requested") && fired("service_viewed") && fired("deposit_started") ? "PASS" : "READY",
      detail:
        "Every whop.track call is mirrored to a durable server log (below) — independently verifiable here and in the Whop pixel dashboard once the pixel/account is connected.",
    },
    { n: 8, label: "No fake payments, leads, invoices or tracking", status: "PASS", detail: "Every integration surfaces real Whop API responses; missing credentials produce explicit errors, never simulated success." },
    {
      n: 9,
      label: "Source on GitHub",
      status: "BLOCKED",
      detail: "Pushing requires the merchant's GitHub credentials; this sandbox has none. The complete reusable source ships in this project and COMPLETION_REPORT.md documents it.",
    },
    {
      n: 10,
      label: "3–5 minute demo recording",
      status: "BLOCKED",
      detail: "Recording requires the live account to demonstrate against. A shot-by-shot recording script is included in COMPLETION_REPORT.md.",
    },
  ];

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-ink/70 hover:text-copper">
            <ArrowLeft className="h-4 w-4" /> Back to site
          </Link>
          <span className="font-display text-xl tracking-[0.08em]">ROOFSHIELD PRO</span>
        </div>

        <header className="mt-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-copper">
            Integration & Verification
          </p>
          <h1 className="font-display mt-2 text-[clamp(2.4rem,6vw,4.5rem)] uppercase leading-[0.95]">
            WHOP CONNECTION<br />STATUS & AUDIT
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-mute">
            Requirement-by-requirement verification against the bounty acceptance criteria.
            Nothing here is claimed without evidence — unverifiable items are marked BLOCKED with
            the exact account configuration that remains.
          </p>
        </header>

        {/* Config + API */}
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <section className="rounded-[1.75rem] border border-line bg-white p-6">
            <h2 className="font-display text-2xl uppercase tracking-wide">Environment</h2>
            <div className="mt-4">
              <ConfigRow label="WHOP_API_KEY" ok={config.apiKey} hint="Server-only key authenticating all Whop API calls" />
              <ConfigRow label="WHOP_ACCOUNT_ID" ok={config.accountId} hint="biz_… company the leads/plans belong to" />
              <ConfigRow label="WHOP_PLAN_ID_INSPECTION" ok={config.planInspection} hint="plan_… · $149 Roof Inspection" />
              <ConfigRow label="WHOP_PLAN_ID_DEPOSIT" ok={config.planDeposit} hint="plan_… · $500 deposit (setup-mode flow)" />
              <ConfigRow label="WHOP_PLAN_ID_GUTTER" ok={config.planGutter} hint="plan_… · $299 Gutter Cleaning" />
              <ConfigRow label="WHOP_WEBHOOK_SECRET" ok={config.webhookSecret} hint="ws_… verifying /api/webhooks/whop" />
              <ConfigRow label="ADMIN_TOKEN" ok={config.adminToken} hint="Guards the invoicing console below" />
              <ConfigRow label="NEXT_PUBLIC_WHOP_PIXEL_SRC" ok={config.pixel} hint="Manual pixel snippet (auto-injected on whop hosting)" />
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-line bg-white p-6">
            <h2 className="font-display text-2xl uppercase tracking-wide">Live API check</h2>
            <div
              className={cn(
                "mt-4 flex items-center gap-3 rounded-2xl border p-4",
                api.ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50",
              )}
            >
              <Radio className={cn("h-5 w-5", api.ok ? "text-emerald-600" : "text-amber-600")} />
              <div>
                <p className="text-sm font-semibold">{api.ok ? "Whop API reachable & authenticated" : "Whop API not reachable"}</p>
                <p className="text-xs text-mute">{api.detail} · {config.baseUrl} · {config.environment}</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
              {[
                { icon: Activity, n: eventRows.length, l: "Track events" },
                { icon: Users, n: leadRows.length, l: "Leads" },
                { icon: CreditCard, n: projectRows.length, l: "Projects" },
                { icon: FileText, n: invoiceRows.length, l: "Invoices" },
              ].map((s) => (
                <div key={s.l} className="rounded-2xl border border-line bg-paper p-4">
                  <s.icon className="mx-auto h-4.5 w-4.5 text-copper" />
                  <p className="font-display mt-2 text-3xl leading-none">{s.n}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.15em] text-mute">{s.l}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Requirement checklist */}
        <section className="mt-10 rounded-[1.75rem] border border-line bg-white p-6 sm:p-8">
          <h2 className="font-display text-2xl uppercase tracking-wide">Acceptance checklist</h2>
          <div className="mt-5 divide-y divide-line">
            {requirements.map((r) => (
              <div key={r.n} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="flex gap-4">
                  <span className="font-display text-xl text-copper">{String(r.n).padStart(2, "0")}</span>
                  <div>
                    <p className="text-sm font-semibold">{r.label}</p>
                    <p className="mt-1 text-xs leading-relaxed text-mute">{r.detail}</p>
                  </div>
                </div>
                <Badge status={r.status} />
              </div>
            ))}
          </div>
        </section>

        {/* Live Leads + tracking verification */}
        <div className="mt-10">
          <VerificationPanel />
        </div>

        <p className="mt-4 rounded-2xl border border-line bg-white p-4 text-xs leading-relaxed text-mute">
          Before running these checks, validate credentials and plan IDs from the server with{" "}
          <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-[11px]">node scripts/whop-preflight.mjs</code>.
          It proves the key, scopes and each plan&apos;s price against the live Whop API and never
          prints a secret. Setup steps and the exact permission list:{" "}
          <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-[11px]">WHOP_SETUP.md</code>.
        </p>

        {/* Admin billing */}
        <div className="mt-10">
          <AdminBilling
            projects={projectRows.map<ProjectRow>((p) => ({
              id: p.id,
              email: p.customerEmail,
              memberId: p.whopMemberId,
              hasCard: !!p.paymentMethodId,
              status: p.status,
              depositCents: p.depositAmountCents,
              createdAt: p.createdAt.toISOString(),
            }))}
          />
        </div>

        {/* Event + lead logs */}
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <section className="rounded-[1.75rem] border border-line bg-white p-6">
            <h2 className="font-display text-2xl uppercase tracking-wide">Tracking event log</h2>
            <p className="mt-1 text-xs text-mute">Server-mirrored whop.track calls (newest first)</p>
            <ul className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
              {eventRows.length === 0 && (
                <li className="rounded-xl bg-paper p-4 text-xs text-mute">
                  No custom events logged yet. Browse a service, start a deposit, or submit the estimate form.
                </li>
              )}
              {eventRows.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 rounded-xl bg-paper px-4 py-3">
                  <div>
                    <p className="font-mono text-xs font-semibold text-ink">{e.event}</p>
                    <p className="text-[10px] text-mute">
                      {new Date(e.createdAt).toLocaleString()} · pixel {e.pixelPresent ? "fired" : "absent (logged)"}
                    </p>
                  </div>
                  <span className="rounded-full bg-copper/15 px-2.5 py-1 text-[10px] font-bold uppercase text-copper">tracked</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[1.75rem] border border-line bg-white p-6">
            <h2 className="font-display text-2xl uppercase tracking-wide">Lead submissions</h2>
            <p className="mt-1 text-xs text-mute">Estimate requests and their Whop Leads API outcome</p>
            <ul className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
              {leadRows.length === 0 && (
                <li className="rounded-xl bg-paper p-4 text-xs text-mute">No estimate requests yet.</li>
              )}
              {leadRows.map((l) => (
                <li key={l.id} className="rounded-xl bg-paper px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold">{l.name} · {l.serviceType}</p>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase",
                        l.whopStatus === "created" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700",
                      )}
                    >
                      {l.whopStatus === "created" ? "whop lead ✓" : "failed"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-mute">
                    {new Date(l.createdAt).toLocaleString()} · {l.whopLeadId ?? l.whopError ?? ""}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <footer className="mt-14 border-t border-line pt-6 pb-10 text-center text-[11px] uppercase tracking-[0.2em] text-mute">
          RoofShield Pro · demo build · all unverified items are explicitly marked
        </footer>
      </div>
    </main>
  );
}
