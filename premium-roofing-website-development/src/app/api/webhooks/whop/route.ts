import { db } from "@/db";
import { roofingProjects, webhookEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { unwrapWebhook, WebhookVerificationError } from "@whop/sdk/helpers";
import { getWhopConfig } from "@/server/whop";

export const dynamic = "force-dynamic";

/**
 * Whop webhook receiver (Standard Webhooks signatures).
 *
 * Configure in the Whop dashboard → Developers → Webhooks:
 *   URL:    https://<your-domain>/api/webhooks/whop
 *   Events: payment.succeeded, setup_intent.succeeded, invoice.paid
 *
 * Fulfillment state is driven by these verified events — never by browser
 * callbacks, per Whop's guidance.
 */
export async function POST(request: Request) {
  const secret = getWhopConfig().webhookSecret;
  if (!secret) {
    return Response.json(
      { ok: false, code: "WHOP_NOT_CONFIGURED", message: "WHOP_WEBHOOK_SECRET is not set." },
      { status: 503 },
    );
  }

  const payload = await request.text(); // raw bytes — required for verification

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = unwrapWebhook(payload, {
      headers: {
        "webhook-id": request.headers.get("webhook-id") ?? "",
        "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
        "webhook-signature": request.headers.get("webhook-signature") ?? "",
      },
      key: secret,
    }) as typeof event;
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return Response.json({ ok: false, code: "BAD_SIGNATURE" }, { status: 400 });
    }
    throw err;
  }

  const deliveryId = request.headers.get("webhook-id") || `local-${Date.now()}`;
  const type = event.type ?? "unknown";
  const data = (event.data ?? {}) as Record<string, unknown>;

  // Durable audit log (idempotent on the delivery id).
  await db
    .insert(webhookEvents)
    .values({ id: deliveryId, type, payload: event as object })
    .onConflictDoNothing();

  if (type === "payment.succeeded") {
    const paymentId = (data.id as string) ?? null;
    if (paymentId) {
      await db
        .update(roofingProjects)
        .set({ status: "paid" })
        .where(eq(roofingProjects.whopPaymentId, paymentId));
    }
  }

  if (type === "setup_intent.succeeded") {
    const setupIntentId = (data.id as string) ?? null;
    const paymentMethodId = (data.payment_method_id as string) ?? null;
    if (setupIntentId && paymentMethodId) {
      await db
        .update(roofingProjects)
        .set({ paymentMethodId })
        .where(eq(roofingProjects.whopSetupIntentId, setupIntentId));
    }
  }

  return Response.json({ ok: true, received: type });
}
