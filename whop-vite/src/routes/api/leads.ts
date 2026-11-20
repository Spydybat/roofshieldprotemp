import { createFileRoute } from "@tanstack/react-router";
import { and, eq, gte, sql } from "drizzle-orm";
import { getOptionalDb } from "@/db";
import { leads } from "@/db/schema";
import { recordWhopEnquiry } from "@/server/whop-members";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;
const SERVICE_TYPES = new Set(["roof-repair", "roof-replacement", "roof-inspection"]);
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

export const Route = createFileRoute("/api/leads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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

        const db = getOptionalDb();

        // 1. Optional PostgreSQL idempotency + 10-minute email/phone duplicate checks
        if (db) {
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
        }

        // 2. Persist full enquiry into Whop (Members API + Member Notes + Member Metadata).
        //    Only reports success when Whop confirms BOTH the member record AND enquiry details.
        const result = await recordWhopEnquiry({
          ...clean,
          idempotencyKey: body.idempotencyKey,
        });

        if (!result.ok) {
          if (db) {
            await db.insert(leads).values({
              ...clean,
              idempotencyKey: body.idempotencyKey ?? null,
              whopStatus: "failed",
              whopLeadId: result.memberId ?? null,
              whopError: result.message,
            });
          }

          const notConfigured = result.code === "WHOP_NOT_CONFIGURED";
          return Response.json(
            {
              ok: false,
              code: result.code,
              message: notConfigured
                ? "The Whop integration is not configured yet (missing WHOP_API_KEY), so your request could not be delivered. Please contact us by phone."
                : `Whop could not record your request: ${result.message}`,
            },
            { status: notConfigured ? 503 : 502 },
          );
        }

        if (result.duplicate) {
          return Response.json({
            ok: true,
            duplicate: true,
            leadId: result.memberId,
            noteId: result.noteId,
            message:
              result.duplicateReason === "idempotency_key"
                ? "This request was already submitted."
                : "We already have your recent request for this service — our team will be in touch shortly.",
          });
        }

        if (db) {
          await db.insert(leads).values({
            ...clean,
            idempotencyKey: body.idempotencyKey ?? null,
            whopStatus: "created",
            whopLeadId: result.memberId,
          });
        }

        return Response.json({
          ok: true,
          leadId: result.memberId,
          noteId: result.noteId,
          metadataSaved: result.metadataSaved,
          duplicate: false,
        });
      },
    },
  },
});
