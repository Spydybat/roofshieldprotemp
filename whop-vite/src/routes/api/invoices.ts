import { createFileRoute } from "@tanstack/react-router";
import { desc, eq } from "drizzle-orm";
import { getOptionalDb } from "@/db";
import { invoices, roofingProjects } from "@/db/schema";
import { getWhopClient, getWhopConfig, whopErrorMessage } from "@/server/whop";

function authorized(request: Request): boolean {
  const token = getWhopConfig().adminToken;
  return !!token && request.headers.get("x-admin-token") === token;
}

function moneyAmountToCents(amount: string | null | undefined): number {
  if (!amount) return 0;
  const parsed = Number.parseFloat(amount);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

interface ResolvedProject {
  id: string;
  whopMemberId: string | null;
  paymentMethodId: string | null;
  customerEmail: string | null;
  customerName: string | null;
  depositAmountCents: number;
  status: string;
}

export const Route = createFileRoute("/api/invoices")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorized(request)) {
          return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
        }

        const client = getWhopClient();
        const config = getWhopConfig();
        const db = getOptionalDb();

        // Fetch authoritative live invoices from Whop Invoices API
        let whopInvoices: Array<{
          id: string;
          number: string;
          status: string;
          totalCents: number;
          amountDueCents: number;
          customerEmail: string | null;
          memberId: string | null;
          paymentMethodId: string | null;
          checkoutLink: string | null;
          memo: string | null;
          metadata: Record<string, string>;
          createdAt: string;
        }> = [];
        let whopError: string | null = null;

        if (client && config.accountId) {
          try {
            const page = await client.invoices.list({
              account_id: config.accountId,
              first: 50,
              order: "created_at",
              direction: "desc",
            });
            whopInvoices = (page.data ?? []).map((inv) => ({
              id: inv.id,
              number: inv.number,
              status: inv.status,
              totalCents: moneyAmountToCents(inv.total?.amount),
              amountDueCents: moneyAmountToCents(inv.amount_due?.amount),
              customerEmail: inv.email_address ?? null,
              memberId: inv.member_id ?? null,
              paymentMethodId: inv.payment_method_id ?? null,
              checkoutLink: inv.checkout_link ?? null,
              memo: inv.memo ?? null,
              metadata: inv.metadata ?? {},
              createdAt: inv.created_at,
            }));
          } catch (err) {
            whopError = whopErrorMessage(err);
          }
        }

        const localRows = db
          ? await db.select().from(invoices).orderBy(desc(invoices.createdAt)).limit(50)
          : [];

        return Response.json({
          ok: true,
          source: db ? "whop-api+postgres" : "whop-api",
          invoices: whopInvoices,
          ...(whopError ? { whopError } : {}),
          ...(db ? { localAuditRows: localRows } : {}),
        });
      },

      POST: async ({ request }) => {
        if (!authorized(request)) {
          return Response.json(
            { ok: false, code: "UNAUTHORIZED", message: "Missing or invalid x-admin-token." },
            { status: 401 },
          );
        }

        let body: {
          projectId?: string;
          email?: string;
          customerName?: string;
          contractTotalUsd?: number;
          notes?: string;
          method?: "auto" | "manual";
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ ok: false, code: "BAD_JSON" }, { status: 400 });
        }

        const contractTotalCents = Math.round((body.contractTotalUsd ?? 0) * 100);
        if (!Number.isFinite(contractTotalCents) || contractTotalCents <= 0) {
          return Response.json(
            { ok: false, code: "BAD_AMOUNT", message: "Enter a contract total greater than zero." },
            { status: 422 },
          );
        }
        if ((body.method ?? "manual") === "manual" && !body.email && !body.projectId) {
          return Response.json(
            { ok: false, code: "EMAIL_REQUIRED", message: "Manual invoices need a customer email or project." },
            { status: 422 },
          );
        }

        const client = getWhopClient();
        const config = getWhopConfig();
        if (!client || !config.accountId) {
          return Response.json({ ok: false, code: "WHOP_NOT_CONFIGURED" }, { status: 503 });
        }

        const db = getOptionalDb();
        let project: ResolvedProject | undefined;
        let pgProjectId: string | null = null;

        if (body.projectId) {
          if (body.projectId.startsWith("pay_")) {
            // Resolve Whop-native deposit project directly from Whop Payments API
            try {
              const payment = await client.payments.retrieve({ id: body.projectId });
              const meta = (payment.metadata ?? {}) as Record<string, unknown>;
              const metaDeposit =
                typeof meta.deposit_amount_cents === "string"
                  ? Number.parseInt(meta.deposit_amount_cents, 10)
                  : NaN;
              const depositAmountCents = Number.isFinite(metaDeposit)
                ? metaDeposit
                : moneyAmountToCents(payment.total?.amount) || 50000;
              project = {
                id: payment.id,
                whopMemberId: payment.member_id ?? null,
                paymentMethodId:
                  payment.payment_method_id ??
                  (typeof meta.payment_method_id === "string" ? meta.payment_method_id : null),
                customerEmail:
                  payment.customer_email ??
                  (typeof meta.customer_email === "string" ? meta.customer_email : null),
                customerName: payment.user?.name ?? null,
                depositAmountCents,
                status: payment.status,
              };
            } catch {
              return Response.json({ ok: false, code: "PROJECT_NOT_FOUND" }, { status: 404 });
            }
          } else if (db) {
            const rows = await db
              .select()
              .from(roofingProjects)
              .where(eq(roofingProjects.id, body.projectId))
              .limit(1);
            if (!rows[0]) {
              return Response.json({ ok: false, code: "PROJECT_NOT_FOUND" }, { status: 404 });
            }
            pgProjectId = rows[0].id;
            project = {
              id: rows[0].id,
              whopMemberId: rows[0].whopMemberId,
              paymentMethodId: rows[0].paymentMethodId,
              customerEmail: rows[0].customerEmail,
              customerName: rows[0].customerName,
              depositAmountCents: rows[0].depositAmountCents,
              status: rows[0].status,
            };
          } else {
            return Response.json(
              {
                ok: false,
                code: "PROJECT_NOT_FOUND",
                message: "Use a Whop deposit payment ID (pay_…) when DATABASE_URL is not configured.",
              },
              { status: 404 },
            );
          }
        }

        const depositCredited =
          project && (project.status === "paid" || project.status === "succeeded")
            ? project.depositAmountCents
            : 0;
        const balanceCents = contractTotalCents - depositCredited;
        if (balanceCents <= 0) {
          return Response.json(
            {
              ok: false,
              code: "NOTHING_DUE",
              message: "The recorded deposit already covers the full contract total.",
            },
            { status: 422 },
          );
        }

        const wantAuto = body.method === "auto";
        const paymentMethodId = wantAuto ? (project?.paymentMethodId ?? null) : null;
        if (wantAuto && !paymentMethodId) {
          return Response.json(
            {
              ok: false,
              code: "NO_CARD_ON_FILE",
              message:
                "This project has no consented saved payment method. Create a manual invoice instead.",
            },
            { status: 409 },
          );
        }

        const email = body.email ?? project?.customerEmail ?? undefined;
        const memberId = project?.whopMemberId ?? undefined;
        if (!email && !memberId) {
          return Response.json(
            { ok: false, code: "NO_CUSTOMER", message: "Provide a customer email address." },
            { status: 422 },
          );
        }

        try {
          const description = `Roofing project final balance — contract total $${(contractTotalCents / 100).toFixed(2)}${depositCredited ? `, deposit of $${(depositCredited / 100).toFixed(2)} credited` : ""}${body.notes ? ` · ${body.notes}` : ""}`;

          // Per Whop CreateInvoicesRequest spec, `member_id` and `email_address` are mutually exclusive.
          const customerTarget = memberId
            ? { member_id: memberId }
            : { email_address: email };

          const draft = await client.invoices.create({
            account_id: config.accountId,
            items: [
              {
                quantity: 1,
                variant: {
                  account_id: config.accountId,
                  currency: "usd",
                  initial_price: balanceCents / 100,
                  billing_type: "one_time",
                  description,
                },
              },
            ] as never,
            ...customerTarget,
            customer_name: body.customerName ?? project?.customerName ?? undefined,
            payment_method_id: paymentMethodId ?? undefined,
            memo: body.notes?.trim() || description,
            metadata: {
              flow: "roofshield_final_balance",
              project_id: project?.id ?? "",
              collection: wantAuto ? "charge_automatically" : "send_invoice",
              contract_total_cents: String(contractTotalCents),
              deposit_credited_cents: String(depositCredited),
              balance_cents: String(balanceCents),
            },
          });

          if (!draft.id) throw new Error("Whop returned an invoice without an id");

          const finalized = wantAuto
            ? await client.invoices.issue({ id: draft.id })
            : await client.invoices.send({ id: draft.id });

          if (db) {
            await db.insert(invoices).values({
              projectId: pgProjectId,
              whopInvoiceId: finalized.id ?? draft.id,
              collectionMethod: wantAuto ? "charge_automatically" : "send_invoice",
              contractTotalCents,
              depositCreditedCents: depositCredited,
              balanceCents,
              customerEmail: email ?? null,
              whopStatus: finalized.status ?? "unknown",
              status: "finalized",
              notes: body.notes ?? null,
            });
          }

          return Response.json({
            ok: true,
            invoiceId: finalized.id ?? draft.id,
            invoiceNumber: finalized.number ?? null,
            whopStatus: finalized.status ?? "unknown",
            checkoutLink: finalized.checkout_link ?? null,
            collectionMethod: wantAuto ? "charge_automatically" : "send_invoice",
            balanceUsd: balanceCents / 100,
          });
        } catch (err) {
          const message = whopErrorMessage(err);
          if (db) {
            await db.insert(invoices).values({
              projectId: pgProjectId,
              collectionMethod: wantAuto ? "charge_automatically" : "send_invoice",
              contractTotalCents,
              depositCreditedCents: depositCredited,
              balanceCents,
              customerEmail: email ?? null,
              whopStatus: "error",
              status: "failed",
              whopError: message,
              notes: body.notes ?? null,
            });
          }
          return Response.json({ ok: false, code: "WHOP_API_ERROR", message }, { status: 502 });
        }
      },
    },
  },
});
