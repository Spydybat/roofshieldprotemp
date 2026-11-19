import { db } from "@/db";
import { leads } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { createWhopMember } from "@/server/whop-members";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

/** The only three service types the form offers — enforced server-side too. */
const SERVICE_TYPES = new Set(["roof-repair", "roof-replacement", "roof-inspection"]);

/** Window in which an identical submission is treated as a duplicate. */
const DEDUPE_WINDOW_MINUTES = 10;

interface LeadBody {
  name?: string;
  email?: string;
  phone?: string;
  zip?: string;
  serviceType?: string;
  description?: string;
  idempotencyKey?: string;
}

function validate(body: LeadBody): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!body.name || body.name.trim().length < 2) errors.name = "Please enter your full name.";
  if (!body.email || !EMAIL_RE.test(body.email.trim())) errors.email = "Please enter a valid email address.";
  if (!body.phone || body.phone.replace(/\D/g, "").length < 7) errors.phone = "Please enter a valid phone number.";
  if (!body.zip || !ZIP_RE.test(body.zip.trim())) errors.zip = "Enter a valid 5-digit ZIP code.";
  if (!body.serviceType || !SERVICE_TYPES.has(body.serviceType))
    errors.serviceType = "Please choose a service.";
  if (!body.description || body.description.trim().length < 10)
    errors.description = "Tell us a little more about the project (min. 10 characters).";
  return errors;
}

export async function POST(request: Request) {
  let body: LeadBody;
  try {
    body = (await request.json()) as LeadBody;
  } catch {
    return Response.json({ ok: false, code: "BAD_JSON", message: "Invalid request body." }, { status: 400 });
  }

  const errors = validate(body);
  if (Object.keys(errors).length > 0) {
    return Response.json({ ok: false, code: "VALIDATION", errors }, { status: 422 });
  }

  const clean = {
    name: body.name!.trim(),
    email: body.email!.trim().toLowerCase(),
    phone: body.phone!.trim(),
    zip: body.zip!.trim(),
    serviceType: body.serviceType!,
    description: body.description!.trim(),
  };

  /* ── Duplicate prevention ──────────────────────────────────────────────── */

  // 1. Idempotency key: a retried/double-posted request resolves to the same lead.
  if (body.idempotencyKey) {
    const prior = await db
      .select()
      .from(leads)
      .where(eq(leads.idempotencyKey, body.idempotencyKey))
      .limit(1);
    if (prior[0]) {
      return Response.json({
        ok: prior[0].whopStatus === "created",
        duplicate: true,
        leadId: prior[0].whopLeadId,
        message: "This request was already submitted.",
      });
    }
  }

  // 2. Same person + same service within the dedupe window → do not re-create.
  const since = new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60 * 1000);
  const recent = await db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.whopStatus, "created"),
        eq(leads.serviceType, clean.serviceType),
        gte(leads.createdAt, since),
        sql`(lower(${leads.email}) = ${clean.email} or regexp_replace(${leads.phone}, '[^0-9]', '', 'g') = regexp_replace(${clean.phone}, '[^0-9]', '', 'g'))`,
      ),
    )
    .limit(1);

  if (recent[0]) {
    return Response.json({
      ok: true,
      duplicate: true,
      leadId: recent[0].whopLeadId,
      message:
        "We already have your recent request for this service — our team will be in touch shortly.",
    });
  }

  /* ── Real Whop lead capture (Members API — the Leads API is retired) ───── */

  const result = await createWhopMember({ email: clean.email, name: clean.name });

  if (!result.ok) {
    await db.insert(leads).values({
      ...clean,
      idempotencyKey: body.idempotencyKey ?? null,
      whopStatus: "failed",
      whopError: result.message,
    });

    const notConfigured = result.code === "WHOP_NOT_CONFIGURED";
    return Response.json(
      {
        ok: false,
        code: result.code,
        message: notConfigured
          ? "The Whop integration is not configured yet (missing WHOP_API_KEY / WHOP_ACCOUNT_ID), so your request could not be delivered. Please contact us by phone."
          : `Whop could not record your request: ${result.message}`,
      },
      { status: notConfigured ? 503 : 502 },
    );
  }

  await db.insert(leads).values({
    ...clean,
    idempotencyKey: body.idempotencyKey ?? null,
    whopStatus: "created",
    whopLeadId: result.member.id,
  });

  // Success is reported ONLY after Whop returns a persisted member/lead id.
  return Response.json({ ok: true, leadId: result.member.id, duplicate: false });
}
