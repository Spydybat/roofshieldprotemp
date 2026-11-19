import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { pricing } from "@/config/site";
import WhopElementTestbed from "@/components/checkout/WhopElementTestbed";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Checkout sandbox test — RoofShield Pro",
  robots: { index: false, follow: false },
};

export default function CheckoutTestPage() {
  const configured = {
    inspection: process.env.WHOP_PLAN_ID_INSPECTION || null,
    deposit: process.env.WHOP_PLAN_ID_DEPOSIT || null,
    gutter: process.env.WHOP_PLAN_ID_GUTTER || null,
    accountId: process.env.WHOP_ACCOUNT_ID || null,
  };
  const hasCreds = !!(process.env.WHOP_API_KEY && process.env.WHOP_ACCOUNT_ID);

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <Link href="/#pricing" className="flex items-center gap-2 text-sm font-semibold text-ink/70 hover:text-copper">
          <ArrowLeft className="h-4 w-4" /> Back to pricing
        </Link>

        <header className="mt-8">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-copper">
            <FlaskConical className="h-4 w-4" /> Whop Payments · Elements
          </p>
          <h1 className="font-display mt-2 text-[clamp(2.2rem,6vw,4rem)] uppercase leading-[0.95]">
            Checkout sandbox test
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-mute">
            Verify the three plans render real Payment Elements and complete a sandbox checkout with
            Whop-hosted frames. No fake buttons, no simulated success.
          </p>
        </header>

        <div className="mt-8 rounded-[1.75rem] border border-line bg-white p-6 sm:p-8">
          <h2 className="font-display text-2xl uppercase tracking-wide">Configured plans</h2>
          <ul className="mt-4 space-y-2 font-mono text-xs">
            {pricing.map((p) => {
              const id = configured[p.key as keyof typeof configured];
              return (
                <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper px-4 py-3">
                  <span className="font-sans font-semibold text-ink">{p.name} — ${p.price}</span>
                  <span className={id ? "text-emerald-700" : "text-amber-700"}>
                    {id ? id : "not set"}
                  </span>
                </li>
              );
            })}
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper px-4 py-3">
              <span className="font-sans font-semibold text-ink">Account</span>
              <span className={configured.accountId ? "text-emerald-700" : "text-amber-700"}>
                {configured.accountId ?? "WHOP_ACCOUNT_ID not set"}
              </span>
            </li>
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper px-4 py-3">
              <span className="font-sans font-semibold text-ink">API key</span>
              <span className={hasCreds ? "text-emerald-700" : "text-amber-700"}>
                {hasCreds ? "configured" : "WHOP_API_KEY not set"}
              </span>
            </li>
          </ul>
        </div>

        <div className="mt-6">
          <WhopElementTestbed />
        </div>

        <p className="mt-8 text-center text-[11px] uppercase tracking-[0.2em] text-mute">
          Diagnostic page · excluded from search indexing
        </p>
      </div>
    </main>
  );
}
