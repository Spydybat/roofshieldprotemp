import { db } from "@/db";
import { roofingProjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getWhopClient, getWhopConfig, whopErrorMessage } from "@/server/whop";

export const dynamic = "force-dynamic";

/**
 * Completes the $500 deposit after the setup-mode checkout saved the buyer's
 * payment method (setup intent). Charges the deposit plan to the saved card
 * off-session. Idempotent per setup intent — a retry or double-submit returns
 * the original charge instead of charging twice.
 *
 * Card numbers/CVV never touch this application: Whop's hosted elements collect
 * them and Whop returns opaque `payt_…` identifiers.
 */
export async function POST(request: Request) {
  let body: { setupIntentId?: string; consent?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, code: "BAD_JSON" }, { status: 400 });
  }

  if (!body.setupIntentId || !body.setupIntentId.startsWith("sint_")) {
    return Response.json({ ok: false, code: "BAD_SETUP_INTENT" }, { status: 422 });
  }
  if (body.consent !== true) {
    return Response.json(
      { ok: false, code: "CONSENT_REQUIRED", message: "Card-on-file consent is required." },
      { status: 422 },
    );
  }

  const client = getWhopClient();
  const config = getWhopConfig();
  const depositPlanId = config.plans.deposit;
  if (!client || !config.accountId || !depositPlanId) {
    return Response.json({ ok: false, code: "WHOP_NOT_CONFIGURED" }, { status: 503 });
  }

  // Idempotency: already processed?
  const existing = await db
    .select()
    .from(roofingProjects)
    .where(eq(roofingProjects.whopSetupIntentId, body.setupIntentId))
    .limit(1);
  if (existing[0]?.whopPaymentId) {
    return Response.json({
      ok: true,
      idempotent: true,
      paymentId: existing[0].whopPaymentId,
      status: existing[0].status,
      projectId: existing[0].id,
    });
  }

  try {
    const intent = await client.setupIntents.retrieve({ id: body.setupIntentId });
    const si = intent as unknown as {
      id: string;
      status?: string;
      payment_method_id?: string | null;
      member_id?: string | null;
      email?: string | null;
      member?: { id?: string } | null;
    };

    if (si.status !== "succeeded" || !si.payment_method_id) {
      return Response.json(
        {
          ok: false,
          code: "SETUP_NOT_COMPLETE",
          status: si.status ?? "unknown",
          message: "The payment method has not finished being saved yet.",
        },
        { status: 409 },
      );
    }

    const memberId = si.member_id ?? si.member?.id ?? null;
    if (!memberId) {
      return Response.json(
        { ok: false, code: "NO_MEMBER", message: "No buyer member is attached to the saved card." },
        { status: 409 },
      );
    }

    // Record the project + consent first (audit trail of the authorization).
    const [project] = await db
      .insert(roofingProjects)
      .values({
        planKey: "deposit",
        whopSetupIntentId: body.setupIntentId,
        whopMemberId: memberId,
        paymentMethodId: si.payment_method_id,
        customerEmail: si.email ?? null,
        cardOnFileConsent: true,
        consentAt: new Date(),
        status: "initiated",
      })
      .returning();

    // Charge the documented $500 deposit plan to the consented card on file.
    const payment = await client.payments.create({
      account_id: config.accountId,
      variant_id: depositPlanId,
      member_id: memberId,
      payment_method_id: si.payment_method_id,
      off_session: true,
      metadata: {
        flow: "roofshield_project_deposit",
        setup_intent_id: body.setupIntentId,
        project_id: project.id,
      },
    });

    const p = payment as unknown as { id?: string; status?: string };
    const status = p.status ?? "unknown";
    // Only "succeeded" is a confirmed paid deposit. An off-session charge can
    // come back requires_action (e.g. 3DS with no buyer present), processing, or
    // failed — none of which may be reported as a completed payment.
    const succeeded = status === "succeeded";

    await db
      .update(roofingProjects)
      .set({ whopPaymentId: p.id ?? null, status: succeeded ? "paid" : status })
      .where(eq(roofingProjects.id, project.id));

    return Response.json({
      ok: true,
      succeeded,
      paymentId: p.id ?? null,
      status,
      projectId: project.id,
      ...(succeeded
        ? {}
        : {
            message:
              status === "requires_action"
                ? "The saved card needs additional authentication (e.g. 3-D Secure) before the deposit can be charged. We'll follow up to complete it."
                : status === "processing"
                  ? "The deposit charge is processing. You'll receive a Whop receipt once it settles."
                  : `The deposit charge did not complete (status: ${status}).`,
          }),
    });
  } catch (err) {
    return Response.json(
      { ok: false, code: "WHOP_API_ERROR", message: whopErrorMessage(err) },
      { status: 502 },
    );
  }
}
