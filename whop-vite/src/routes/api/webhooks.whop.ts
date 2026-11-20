import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { unwrapWebhook, WebhookVerificationError } from "@whop/sdk/helpers";
import { getOptionalDb } from "@/db";
import { roofingProjects, webhookEvents } from "@/db/schema";
import { getWhopConfig } from "@/server/whop";

export const Route = createFileRoute("/api/webhooks/whop")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = getWhopConfig().webhookSecret;
        if (!secret) {
          return Response.json(
            { ok: false, code: "WHOP_NOT_CONFIGURED", message: "WHOP_WEBHOOK_SECRET is not set." },
            { status: 503 },
          );
        }

        const payload = await request.text();

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

        const deliveryId = request.headers.get("webhook-id") || `whop-${Date.now()}`;
        const type = event.type ?? "unknown";
        const data = (event.data ?? {}) as Record<string, unknown>;

        const db = getOptionalDb();
        if (db) {
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
        }

        return Response.json({ ok: true, received: type, persistedLocally: !!db });
      },
    },
  },
});
