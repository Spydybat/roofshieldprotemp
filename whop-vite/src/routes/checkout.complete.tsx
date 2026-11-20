import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, AlertTriangle, XCircle, ArrowLeft } from "lucide-react";

type CompleteSearch = {
  status?: string;
  payment?: string;
  setup?: string;
};

export const Route = createFileRoute("/checkout/complete")({
  validateSearch: (search: Record<string, unknown>): CompleteSearch => ({
    status: typeof search.status === "string" ? search.status : undefined,
    payment: typeof search.payment === "string" ? search.payment : undefined,
    setup: typeof search.setup === "string" ? search.setup : undefined,
  }),
  component: CheckoutCompletePage,
});

function CheckoutCompletePage() {
  const { status, payment, setup } = Route.useSearch();
  const ref = payment ?? setup;

  const states = {
    succeeded: {
      icon: CheckCircle2,
      tone: "text-emerald-600 bg-emerald-50",
      title: "Payment complete",
      body: "Your payment was successful. A confirmation from Whop is on its way to your inbox.",
    },
    processing: {
      icon: AlertTriangle,
      tone: "text-amber-600 bg-amber-50",
      title: "Payment processing",
      body: "Your payment is being processed. You'll receive confirmation from Whop shortly.",
    },
    canceled: {
      icon: XCircle,
      tone: "text-red-600 bg-red-50",
      title: "Checkout canceled",
      body: "The checkout was canceled before completion — no payment was taken.",
    },
    failed: {
      icon: XCircle,
      tone: "text-red-600 bg-red-50",
      title: "Payment failed",
      body: "The payment could not be completed. No charge succeeded — please try again or contact us.",
    },
  } as const;

  const state = states[status as keyof typeof states] ?? {
    icon: AlertTriangle,
    tone: "text-amber-600 bg-amber-50",
    title: "Payment status unknown",
    body: "We couldn't determine the payment outcome from this link. If you completed checkout, your Whop receipt is authoritative.",
  };

  const Icon = state.icon;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink p-6 text-white">
      <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 text-center backdrop-blur">
        <span className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${state.tone}`}>
          <Icon className="h-8 w-8" />
        </span>
        <h1 className="font-display mt-6 text-4xl uppercase tracking-wide">{state.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/65">{state.body}</p>
        {ref && (
          <p className="mt-4 rounded-full bg-white/10 px-4 py-2 font-mono text-xs text-white/60">
            {payment ? "Payment" : "Setup"}: {ref}
          </p>
        )}
        <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-white/35">
          Status reported: {status ?? "—"}
        </p>
        <Link
          to="/"
          className="btn-lux mt-8 inline-flex items-center gap-2 rounded-full bg-copper px-7 py-3.5 text-sm font-semibold text-white"
          style={{ ["--btn-sweep" as string]: "#f7f7f5" }}
        >
          <ArrowLeft className="h-4 w-4" /> Back to RoofShield Pro
        </Link>
      </div>
    </main>
  );
}
