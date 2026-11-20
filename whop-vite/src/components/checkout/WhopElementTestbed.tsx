"use client";

import { useMemo, useState } from "react";
import { loadWhop } from "@whop/elements";
import {
  WhopElements,
  Checkout,
  CheckoutElement,
  ExpressCheckoutElement,
  Payments,
  BrandingElement,
  type CheckoutPaymentCompletion,
  type CheckoutSetupCompletion,
  type CheckoutWaitlistCompletion,
} from "@whop/elements-react";
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

let elementsPromise: ReturnType<typeof loadWhop> | null = null;
function getElements() {
  if (!elementsPromise) elementsPromise = loadWhop();
  return elementsPromise;
}

type CompletionPayload =
  | CheckoutPaymentCompletion
  | CheckoutWaitlistCompletion
  | CheckoutSetupCompletion;

export default function WhopElementTestbed() {
  const [planId, setPlanId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [mounted, setMounted] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [failed, setFailed] = useState(false);

  const valid = useMemo(
    () => /^plan_[A-Za-z0-9]+$/.test(planId.trim()) && /^biz_[A-Za-z0-9]+$/.test(accountId.trim()),
    [planId, accountId],
  );

  const onComplete = (payload: CompletionPayload) => {
    if (payload.result === "payment") {
      setResult({ ok: true, text: `Payment succeeded · ${payload.paymentId} · session ${payload.sessionId}` });
    } else if (payload.result === "setup") {
      setResult({ ok: true, text: `Setup intent saved · ${payload.setupIntentId} · session ${payload.sessionId}` });
    } else {
      setResult({ ok: true, text: `Waitlist entry recorded · session ${payload.sessionId}` });
    }
  };

  return (
    <div className="rounded-[1.75rem] border border-line bg-white p-6 sm:p-8">
      <h3 className="font-display text-2xl uppercase tracking-wide text-ink">
        Sandbox checkout self-test
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-mute">
        Mounts the real hosted Whop elements: <strong>CheckoutElement</strong> (card) and{" "}
        <strong>ExpressCheckoutElement</strong> (Apple Pay / Google Pay), plus the mandatory{" "}
        <strong>BrandingElement</strong>. Paste a plan + account ID to connect any plan and run a
        sandbox checkout. Nothing here is simulated — the frames come from Whop&apos;s CDN and the
        payment result is whatever Whop actually returns.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
            Plan ID
          </span>
          <input
            className={cn("field font-mono text-xs", planId && !/^plan_/.test(planId) && "field-error")}
            placeholder="plan_xxxxxxxx"
            value={planId}
            onChange={(e) => {
              setPlanId(e.target.value);
              setMounted(false);
              setResult(null);
            }}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
            Account ID
          </span>
          <input
            className={cn("field font-mono text-xs", accountId && !/^biz_/.test(accountId) && "field-error")}
            placeholder="biz_xxxxxxxx"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setMounted(false);
              setResult(null);
            }}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="grid grid-cols-2 gap-1 rounded-full border border-line bg-paper p-1">
          {(["sandbox", "production"] as const).map((env) => (
            <button
              key={env}
              onClick={() => {
                setEnvironment(env);
                setMounted(false);
                setResult(null);
              }}
              className={cn(
                "rounded-full px-5 py-2 text-[11px] font-bold uppercase tracking-[0.15em] transition-all",
                environment === env ? "bg-ink text-white" : "text-ink/60",
              )}
            >
              {env}
            </button>
          ))}
        </div>
        <button
          onClick={() => valid && setMounted(true)}
          disabled={!valid || mounted}
          className="btn-lux rounded-full bg-copper px-7 py-3 text-sm font-semibold text-white disabled:opacity-50"
          style={{ ["--btn-sweep" as string]: "#080808" }}
        >
          {mounted ? "Elements mounted" : "Mount real Whop elements"}
        </button>
      </div>

      {mounted && !failed && (
        <div className="mt-6 rounded-2xl border border-line p-5">
          <WhopElements
            elements={getElements()}
            environment={environment}
            onLoadError={(err) => {
              setFailed(true);
              setResult({ ok: false, text: `Whop SDK failed to load from cdn.whop.com: ${err.message}` });
            }}
          >
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-mute">
              Checkout element (card)
            </p>
            <Checkout plan={planId.trim()} onComplete={onComplete} returnUrl={undefined}>
              <CheckoutElement />
            </Checkout>

            <p className="mb-3 mt-6 text-[10px] font-semibold uppercase tracking-[0.25em] text-mute">
              Express checkout element (wallets)
            </p>
            <Checkout plan={planId.trim()} onComplete={onComplete} returnUrl={undefined}>
              <ExpressCheckoutElement />
            </Checkout>

            <p className="mb-2 mt-6 text-[10px] font-semibold uppercase tracking-[0.25em] text-mute">
              Branding element (required)
            </p>
            <Payments accountId={accountId.trim()} plan={planId.trim()}>
              <BrandingElement />
            </Payments>
          </WhopElements>
        </div>
      )}

      {result && (
        <div
          className={cn(
            "mt-4 flex items-start gap-2.5 rounded-2xl border p-4 text-sm",
            result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800",
          )}
        >
          {result.ok ? <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0" /> : <XCircle className="mt-0.5 h-4.5 w-4.5 shrink-0" />}
          <span className="font-mono text-xs leading-relaxed">{result.text}</span>
        </div>
      )}

      {!mounted && !result && (
        <div className="mt-6 flex items-start gap-2.5 rounded-2xl border border-dashed border-line p-4 text-sm text-mute">
          <Loader2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-copper" />
          Enter valid <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-xs">plan_…</code> and{" "}
          <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-xs">biz_…</code> values to load the hosted frames.
        </div>
      )}

      <div className="mt-5 flex items-center gap-2 text-[11px] text-mute">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        Sandbox environment uses Whop&apos;s test API (when enabled on the account); production uses live billing.
      </div>
    </div>
  );
}
