import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { getOptionalDb } from "@/db";
import { roofingProjects } from "@/db/schema";
import { getWhopClient, getWhopConfig, whopErrorMessage } from "@/server/whop";
import { appendWhopMemberNote } from "@/server/whop-members";

export const Route = createFileRoute("/api/deposit/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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

        const db = getOptionalDb();

        // 1. Optional PostgreSQL idempotency check
        if (db) {
          const existing = await db
            .select()
            .from(roofingProjects)
            .where(eq(roofingProjects.whopSetupIntentId, body.setupIntentId))
            .limit(1);
          if (existing[0]?.whopPaymentId) {
            return Response.json({
              ok: true,
              idempotent: true,
              succeeded: existing[0].status === "paid" || existing[0].status === "succeeded",
              paymentId: existing[0].whopPaymentId,
              status: existing[0].status,
              projectId: existing[0].id,
            });
          }
        }

        try {
          const si = await client.setupIntents.retrieve({ id: body.setupIntentId });

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

          const memberId = si.member_id ?? null;
          if (!memberId) {
            return Response.json(
              { ok: false, code: "NO_MEMBER", message: "No buyer member is attached to the saved card." },
              { status: 409 },
            );
          }

          // 2. Whop-native idempotency check (works even without PostgreSQL)
          try {
            const existingPayments = await client.payments.list({
              account_id: config.accountId,
              member_id: memberId,
              variant_id: depositPlanId,
              first: 20,
            });
            const priorPayment = (existingPayments.data ?? []).find((p) => {
              const meta = (p.metadata ?? {}) as Record<string, unknown>;
              return meta.setup_intent_id === body.setupIntentId;
            });
            if (priorPayment) {
              const paid = priorPayment.status === "paid";
              return Response.json({
                ok: true,
                idempotent: true,
                succeeded: paid,
                paymentId: priorPayment.id,
                status: paid ? "succeeded" : priorPayment.status,
                projectId: priorPayment.id,
              });
            }
          } catch {
            // Proceed using Whop's native Idempotency-Key header below.
          }

          const memberDetails = await client.members.retrieve({ id: memberId }).catch(() => null);
          const customerEmail = memberDetails?.email ?? null;
          const customerName = memberDetails?.name ?? si.user?.name ?? null;
          const consentAt = new Date();
          let pgProjectId: string | null = null;

          // 3. Mirror project + consent into PostgreSQL when DATABASE_URL is configured
          if (db) {
            const [project] = await db
              .insert(roofingProjects)
              .values({
                planKey: "deposit",
                whopSetupIntentId: body.setupIntentId,
                whopMemberId: memberId,
                paymentMethodId: si.payment_method_id,
                customerEmail,
                customerName,
                cardOnFileConsent: true,
                consentAt,
                status: "initiated",
              })
              .returning();
            pgProjectId = project?.id ?? null;
          }

          // 4. Charge the documented $500 deposit plan off-session with native Whop Idempotency-Key
          const payment = await client.payments.create(
            {
              account_id: config.accountId,
              variant_id: depositPlanId,
              member_id: memberId,
              payment_method_id: si.payment_method_id,
              off_session: true,
              metadata: {
                flow: "roofshield_project_deposit",
                setup_intent_id: body.setupIntentId,
                payment_method_id: si.payment_method_id,
                card_on_file_consent: "true",
                consent_at: consentAt.toISOString(),
                deposit_amount_cents: "50000",
                ...(pgProjectId ? { project_id: pgProjectId } : {}),
                ...(customerEmail ? { customer_email: customerEmail } : {}),
              },
            },
            {
              idempotencyKey: `roofshield-deposit-${body.setupIntentId}`,
            },
          );

          // Payment collection runs asynchronously on Whop: ReceiptStatus is "paid" | "open" | "pending" | ...
          // Poll retrieveStatus once to obtain the granular PaymentStatus ("succeeded" | "processing" | "requires_action" | ...).
          let finalStatus: string = payment.status ?? "unknown";
          let succeeded = payment.status === "paid";

          if (!succeeded && payment.id) {
            try {
              const paymentStatus = await client.payments.retrieveStatus({ payment_id: payment.id });
              finalStatus = paymentStatus.status ?? finalStatus;
              succeeded = finalStatus === "succeeded";
            } catch {
              // Keep receipt status returned by payments.create
            }
          } else if (succeeded) {
            finalStatus = "succeeded";
          }

          if (db && pgProjectId) {
            await db
              .update(roofingProjects)
              .set({ whopPaymentId: payment.id ?? null, status: succeeded ? "paid" : finalStatus })
              .where(eq(roofingProjects.id, pgProjectId));
          }

          // Best-effort Whop member audit note recording deposit + card-on-file consent
          void appendWhopMemberNote(
            memberId,
            [
              "[RoofShield Pro Deposit & Card-on-File Consent]",
              `Consent Recorded: ${consentAt.toISOString()}`,
              `Setup Intent: ${body.setupIntentId}`,
              `Saved Payment Method: ${si.payment_method_id}`,
              `Deposit Payment: ${payment.id} (${finalStatus})`,
              `Amount: $500.00 (plan ${depositPlanId})`,
            ].join("\n"),
          );

          return Response.json({
            ok: true,
            succeeded,
            paymentId: payment.id ?? null,
            status: finalStatus,
            projectId: pgProjectId ?? payment.id,
            ...(succeeded
              ? {}
              : {
                  message:
                    finalStatus === "requires_action"
                      ? "The saved card needs additional authentication (e.g. 3-D Secure) before the deposit can be charged. We'll follow up to complete it."
                      : finalStatus === "processing" || finalStatus === "confirming" || finalStatus === "pending"
                        ? "The deposit charge is processing. You'll receive a Whop receipt once it settles."
                        : `The deposit charge did not complete (status: ${finalStatus}).`,
                }),
          });
        } catch (err) {
          return Response.json(
            { ok: false, code: "WHOP_API_ERROR", message: whopErrorMessage(err) },
            { status: 502 },
          );
        }
      },
    },
  },
});
