import { getWhopClient, getWhopConfig, whopErrorMessage } from "@/server/whop";
import type { PlanKey } from "@/config/site";

export const dynamic = "force-dynamic";

/**
 * Prepares a Whop checkout for the given plan.
 *
 * - inspection / gutter → returns the plan id; the Checkout element mints the
 *   session client-side (`<Checkout plan="plan_…">`).
 * - deposit → creates a server-side checkout configuration in `setup` mode so
 *   the buyer's card is saved (setup intent, card-on-file) instead of charged
 *   immediately; the $500 deposit is charged to it after consent + completion.
 */
export async function POST(request: Request) {
  let plan: PlanKey;
  try {
    plan = ((await request.json()) as { plan: PlanKey }).plan;
  } catch {
    return Response.json({ ok: false, code: "BAD_JSON" }, { status: 400 });
  }
  if (!["inspection", "deposit", "gutter"].includes(plan)) {
    return Response.json({ ok: false, code: "UNKNOWN_PLAN" }, { status: 422 });
  }

  const config = getWhopConfig();
  const planId = config.plans[plan];
  const accountId = config.accountId;
  const client = getWhopClient();

  const envVar =
    plan === "inspection"
      ? "WHOP_PLAN_ID_INSPECTION"
      : plan === "deposit"
        ? "WHOP_PLAN_ID_DEPOSIT"
        : "WHOP_PLAN_ID_GUTTER";

  if (!client || !accountId) {
    return Response.json(
      {
        ok: false,
        code: "WHOP_NOT_CONFIGURED",
        missing: [
          ...(!config.apiKey ? ["WHOP_API_KEY"] : []),
          ...(!accountId ? ["WHOP_ACCOUNT_ID"] : []),
          ...(!planId ? [envVar] : []),
        ],
      },
      { status: 503 },
    );
  }
  if (!planId) {
    return Response.json(
      { ok: false, code: "PLAN_NOT_CONFIGURED", missing: [envVar] },
      { status: 503 },
    );
  }

  if (plan !== "deposit") {
    return Response.json({
      ok: true,
      flow: "payment",
      plan,
      planId,
      accountId,
      environment: process.env.NEXT_PUBLIC_WHOP_ENV === "sandbox" ? "sandbox" : "production",
    });
  }

  // Deposit → setup-mode checkout configuration (card on file, no immediate charge)
  try {
    const cc = await client.checkoutConfigurations.create({
      account_id: accountId,
      mode: "setup",
      currency: "usd",
      metadata: { flow: "roofshield_deposit_card_on_file", plan_id: planId },
    });
    return Response.json({
      ok: true,
      flow: "setup",
      plan,
      planId,
      accountId,
      checkoutConfigurationId: (cc as { id?: string })?.id ?? null,
      environment: process.env.NEXT_PUBLIC_WHOP_ENV === "sandbox" ? "sandbox" : "production",
    });
  } catch (err) {
    return Response.json(
      { ok: false, code: "WHOP_API_ERROR", message: whopErrorMessage(err) },
      { status: 502 },
    );
  }
}
