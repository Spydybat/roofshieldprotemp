import { db } from "@/db";
import { invoices, roofingProjects } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getWhopClient, getWhopConfig, whopErrorMessage } from "@/server/whop";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const token = getWhopConfig().adminToken;
  return !!token && request.headers.get("x-admin-token") === token;
}

/**
 * Creates a REAL final-balance invoice through the official Whop Invoices API.
 *
 * collection methods:
 *  - "charge_automatically": the invoice carries the saved card (payt_…)
 *    collected with explicit consent during the deposit checkout; issuing it
 *    charges that card.
 *  - "send_invoice": Whop emails the customer a link to pay manually.
 *
 * The invoice status returned by Whop is surfaced verbatim — nothing is
 * pretended to be paid.
 */
export async function POST(request: Request) {
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
  if ((body.method ?? "manual") === "manual" && !body.email) {
    return Response.json(
      { ok: false, code: "EMAIL_REQUIRED", message: "Manual invoices need a customer email." },
      { status: 422 },
    );
  }

  const client = getWhopClient();
  const config = getWhopConfig();
  if (!client || !config.accountId) {
    return Response.json({ ok: false, code: "WHOP_NOT_CONFIGURED" }, { status: 503 });
  }

  // Associate with the roofing project the deposit belongs to, if given.
  let project: (typeof roofingProjects.$inferSelect) | undefined;
  if (body.projectId) {
    const rows = await db
      .select()
      .from(roofingProjects)
      .where(eq(roofingProjects.id, body.projectId))
      .limit(1);
    project = rows[0];
    if (!project) {
      return Response.json({ ok: false, code: "PROJECT_NOT_FOUND" }, { status: 404 });
    }
  }

  const depositCredited = project && project.status === "paid" ? project.depositAmountCents : 0;
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
  if (!email && !project?.whopMemberId) {
    return Response.json(
      { ok: false, code: "NO_CUSTOMER", message: "Provide a customer email address." },
      { status: 422 },
    );
  }

  try {
    const description = `Roofing project final balance — contract total $${(contractTotalCents / 100).toFixed(2)}${depositCredited ? `, deposit of $${(depositCredited / 100).toFixed(2)} credited` : ""}${body.notes ? ` · ${body.notes}` : ""}`;

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
      ] as never, // Item is typed `unknown`; this is the documented inline-variant shape
      email_address: email,
      member_id: project?.whopMemberId ?? undefined,
      customer_name: body.customerName ?? project?.customerName ?? undefined,
      payment_method_id: paymentMethodId ?? undefined,
      metadata: {
        flow: "roofshield_final_balance",
        project_id: project?.id ?? "",
        collection: wantAuto ? "charge_automatically" : "send_invoice",
      },
    });

    const created = draft as unknown as { id?: string; status?: string };
    if (!created.id) throw new Error("Whop returned an invoice without an id");

    // Finalize: issuing charges the card on file; sending emails a pay link.
    const finalized = wantAuto
      ? await client.invoices.issue({ id: created.id })
      : await client.invoices.send({ id: created.id });
    const fin = finalized as unknown as { id?: string; status?: string };

    await db.insert(invoices).values({
      projectId: project?.id ?? null,
      whopInvoiceId: fin.id ?? created.id,
      collectionMethod: wantAuto ? "charge_automatically" : "send_invoice",
      contractTotalCents,
      depositCreditedCents: depositCredited,
      balanceCents,
      customerEmail: email ?? null,
      whopStatus: fin.status ?? "unknown",
      status: "finalized",
      notes: body.notes ?? null,
    });

    return Response.json({
      ok: true,
      invoiceId: fin.id ?? created.id,
      whopStatus: fin.status ?? "unknown",
      collectionMethod: wantAuto ? "charge_automatically" : "send_invoice",
      balanceUsd: balanceCents / 100,
    });
  } catch (err) {
    const message = whopErrorMessage(err);
    await db.insert(invoices).values({
      projectId: project?.id ?? null,
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
    return Response.json({ ok: false, code: "WHOP_API_ERROR", message }, { status: 502 });
  }
}

/** Admin: list invoices recorded locally (newest first). */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  const rows = await db.select().from(invoices).orderBy(desc(invoices.createdAt)).limit(50);
  return Response.json({ ok: true, invoices: rows });
}
