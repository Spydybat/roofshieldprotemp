import { pgTable, uuid, text, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";

/**
 * Estimate requests submitted through the site. Each row mirrors the lead that
 * is created through the official Whop Leads API (whop_lead_id) — the record is
 * kept for auditing even when the Whop call fails. No payment data is stored.
 */
export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  zip: text("zip").notNull(),
  serviceType: text("service_type").notNull(),
  description: text("description").notNull(),
  whopLeadId: text("whop_lead_id"),
  whopStatus: text("whop_status").notNull().default("pending"), // created | failed | duplicate
  whopError: text("whop_error"),
  /** Client-generated key making retries/double-submits idempotent. */
  idempotencyKey: text("idempotency_key").unique(),
});

/**
 * Server-side log of every client-side whop.track call so tracking events are
 * independently verifiable (Whop dashboard when the pixel is live, plus this
 * durable record regardless).
 */
export const trackEvents = pgTable("track_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  event: text("event").notNull(),
  eventId: text("event_id"),
  params: jsonb("params"),
  pixelPresent: boolean("pixel_present").notNull().default(false),
  path: text("path"),
  /** Result of forwarding to Whop's server-side Events API (dashboard-verifiable). */
  whopForwarded: boolean("whop_forwarded").notNull().default(false),
  whopEventError: text("whop_event_error"),
});

/**
 * Roofing projects associated with real Whop payments (deposit checkout flow).
 */
export const roofingProjects = pgTable("roofing_projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  planKey: text("plan_key").notNull().default("deposit"),
  whopPaymentId: text("whop_payment_id").unique(),
  whopSetupIntentId: text("whop_setup_intent_id").unique(),
  whopMemberId: text("whop_member_id"),
  paymentMethodId: text("payment_method_id"), // payt_… saved with customer consent
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),
  depositAmountCents: integer("deposit_amount_cents").notNull().default(50000),
  cardOnFileConsent: boolean("card_on_file_consent").notNull().default(false),
  status: text("status").notNull().default("initiated"), // initiated | paid | requires_action | failed
  consentAt: timestamp("consent_at", { withTimezone: true }),
});

/**
 * Final-balance invoices created through the official Whop Invoices API.
 */
export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  projectId: uuid("project_id").references(() => roofingProjects.id),
  whopInvoiceId: text("whop_invoice_id"),
  collectionMethod: text("collection_method").notNull(), // charge_automatically | send_invoice
  contractTotalCents: integer("contract_total_cents").notNull(),
  depositCreditedCents: integer("deposit_credited_cents").notNull().default(0),
  balanceCents: integer("balance_cents").notNull(),
  customerEmail: text("customer_email"),
  status: text("status").notNull().default("created"),
  whopStatus: text("whop_status"),
  whopError: text("whop_error"),
  notes: text("notes"),
});

/** Raw webhook deliveries received from Whop (Standard Webhooks verified). */
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(), // webhook-id header
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
});
