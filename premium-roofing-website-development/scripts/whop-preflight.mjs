#!/usr/bin/env node
/**
 * Whop integration preflight.
 *
 *   node scripts/whop-preflight.mjs
 *
 * Validates environment configuration and — when credentials exist — proves
 * them against the live Whop API with read-only calls:
 *
 *   • API key authenticates              GET /api/v1/leads?account_id=…
 *   • account id resolves                (implied by the scoped leads read)
 *   • plan ids are real & usable         GET /api/v1/plans/{plan_id}
 *   • invoice permission                 GET /api/v1/invoices?account_id=…
 *   • events/analytics read              GET /api/v1/events?account_id=…
 *
 * SECURITY: this script never prints a secret. Values are reported only as
 * present / absent, plus a length. Account and plan IDs are non-secret
 * identifiers and are shown because you need to confirm they're correct.
 *
 * Exit code 0 = everything required is configured and validated.
 *         1 = something is missing or failed (see the table).
 */

import { readFileSync, existsSync } from "node:fs";

/* ── Load .env files without dotenv ──────────────────────────────────────── */
function loadEnv() {
  const out = {};
  for (const file of [".env", ".env.local", ".env.production"]) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const key = line.slice(0, i).trim();
      let val = line.slice(i + 1).trim();
      // strip inline comments only when unquoted
      if (!/^["']/.test(val)) val = val.split(" #")[0].trim();
      val = val.replace(/^["']|["']$/g, "");
      if (!(key in out) || !out[key]) out[key] = val;
    }
  }
  return { ...out, ...process.env };
}

const env = loadEnv();
const results = [];
function record(name, status, detail) {
  results.push({ name, status, detail });
}

const val = (k) => (env[k] ?? "").trim();

/* ── 1. Presence + format checks (no values echoed) ──────────────────────── */
const required = [
  ["WHOP_API_KEY", () => (val("WHOP_API_KEY").length >= 20 ? null : "set but suspiciously short")],
  ["WHOP_ACCOUNT_ID", () => (/^biz_[A-Za-z0-9]+$/.test(val("WHOP_ACCOUNT_ID")) ? null : "must start with biz_")],
  ["WHOP_PLAN_ID_INSPECTION", () => (/^plan_[A-Za-z0-9]+$/.test(val("WHOP_PLAN_ID_INSPECTION")) ? null : "must start with plan_")],
  ["WHOP_PLAN_ID_DEPOSIT", () => (/^plan_[A-Za-z0-9]+$/.test(val("WHOP_PLAN_ID_DEPOSIT")) ? null : "must start with plan_")],
  ["WHOP_PLAN_ID_GUTTER", () => (/^plan_[A-Za-z0-9]+$/.test(val("WHOP_PLAN_ID_GUTTER")) ? null : "must start with plan_")],
  ["ADMIN_TOKEN", () => (val("ADMIN_TOKEN").length >= 24 ? null : "use a random secret of 32+ chars")],
];

const optional = [
  ["WHOP_PRODUCT_ID", /^prod_[A-Za-z0-9]+$/],
  ["WHOP_WEBHOOK_SECRET", /^ws_[A-Za-z0-9]+$/],
];

for (const [key, check] of required) {
  const v = val(key);
  if (!v) {
    record(key, "MISSING", "not configured");
  } else {
    const problem = check();
    if (problem) record(key, "INVALID", problem);
    else record(key, "SET", `configured (${v.length} chars)`);
  }
}

for (const [key, re] of optional) {
  const v = val(key);
  if (!v) record(key, "OPTIONAL", "not configured");
  else record(key, re.test(v) ? "SET" : "INVALID", re.test(v) ? `configured (${v.length} chars)` : "format looks wrong");
}

// Next.js only inlines NEXT_PUBLIC_* at build time — flag the common mistake.
record(
  "NEXT_PUBLIC_WHOP_ENV",
  val("NEXT_PUBLIC_WHOP_ENV") ? "SET" : "OPTIONAL",
  `Elements environment = ${val("NEXT_PUBLIC_WHOP_ENV") || "production (default)"}`,
);
record(
  "NEXT_PUBLIC_WHOP_PIXEL_SRC",
  val("NEXT_PUBLIC_WHOP_PIXEL_SRC") ? "SET" : "OPTIONAL",
  val("NEXT_PUBLIC_WHOP_PIXEL_SRC")
    ? "manual pixel configured (not needed on whop.app hosting)"
    : "relying on Whop's automatic pixel injection on whop.app",
);

if (val("WHOP_API_KEY") && val("WHOP_API_KEY") === val("NEXT_PUBLIC_WHOP_API_KEY")) {
  record("SECRET HYGIENE", "FAIL", "API key must NEVER be exposed as NEXT_PUBLIC_*");
}

/* ── 2. Live API validation (read-only) ──────────────────────────────────── */
const apiKey = val("WHOP_API_KEY");
const accountId = val("WHOP_ACCOUNT_ID");
const baseUrl = val("WHOP_API_BASE_URL") || "https://api.whop.com";

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error body */
  }
  return { status: res.status, ok: res.ok, json };
}

function apiError(r) {
  return r.json?.error?.message ?? r.json?.message ?? `HTTP ${r.status}`;
}

if (!apiKey || !accountId) {
  record("LIVE API", "BLOCKED", "needs WHOP_API_KEY + WHOP_ACCOUNT_ID");
  record("PLAN IDS", "BLOCKED", "cannot validate plan ids without credentials");
  record("LEADS PERMISSION", "BLOCKED", "cannot verify lead:manage without credentials");
  record("INVOICE PERMISSION", "BLOCKED", "cannot verify invoice scopes without credentials");
  record("EVENTS PERMISSION", "BLOCKED", "cannot verify event:create without credentials");
} else {
  // Leads: the Leads API is retired (410). Capture now goes through Members.
  try {
    const r = await api(`/api/v1/members?account_id=${encodeURIComponent(accountId)}&first=1`);
    if (r.ok) record("LIVE API + MEMBERS", "PASS", "authenticated; members readable (lead capture path)");
    else if (r.status === 401) record("LIVE API + MEMBERS", "FAIL", `authentication rejected — ${apiError(r)}`);
    else if (r.status === 403) record("LIVE API + MEMBERS", "FAIL", `key lacks member permissions — ${apiError(r)}`);
    else record("LIVE API + MEMBERS", "FAIL", apiError(r));
  } catch (e) {
    record("LIVE API + MEMBERS", "FAIL", `network: ${e.message}`);
  }

  // Invoices read — payment:basic:read (needed by invoice creation)
  try {
    const r = await api(`/api/v1/invoices?account_id=${encodeURIComponent(accountId)}&per_page=1`);
    record(
      "INVOICE SCOPES",
      r.ok ? "PASS" : "FAIL",
      r.ok ? "invoices readable (payment:basic:read present)" : apiError(r),
    );
  } catch (e) {
    record("INVOICE SCOPES", "FAIL", `network: ${e.message}`);
  }

  // Events read (API requires from/to ISO when no identifier is given)
  try {
    const to = new Date();
    const from = new Date(to.getTime() - 14 * 24 * 3600 * 1000);
    const r = await api(
      `/api/v1/events?account_id=${encodeURIComponent(accountId)}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&first=1`,
    );
    record("EVENTS READ", r.ok ? "PASS" : "FAIL", r.ok ? "events readable (verification panel can confirm firings)" : apiError(r));
  } catch (e) {
    record("EVENTS READ", "FAIL", `network: ${e.message}`);
  }

  // Plan inventory — are there any plans at all to wire up?
  try {
    const r = await api(`/api/v1/plans?account_id=${encodeURIComponent(accountId)}&first=20`);
    if (r.ok) {
      const n = r.json?.data?.length ?? 0;
      record("PLAN INVENTORY", n > 0 ? "PASS" : "FAIL", n > 0 ? `${n} plan(s) exist on the account` : "no plans exist — create the three one-time plans first");
    } else record("PLAN INVENTORY", "FAIL", apiError(r));
  } catch (e) {
    record("PLAN INVENTORY", "FAIL", `network: ${e.message}`);
  }

  // Plan ids must exist and be purchasable one-time plans
  for (const [label, key, expectedPrice] of [
    ["Roof Inspection", "WHOP_PLAN_ID_INSPECTION", 149],
    ["Roofing Project Deposit", "WHOP_PLAN_ID_DEPOSIT", 500],
    ["Gutter Cleaning", "WHOP_PLAN_ID_GUTTER", 299],
  ]) {
    const id = val(key);
    if (!id) {
      record(`PLAN ${label}`, "MISSING", "env var not set");
      continue;
    }
    try {
      const r = await api(`/api/v1/plans/${encodeURIComponent(id)}`);
      if (!r.ok) {
        record(`PLAN ${label}`, "FAIL", `cannot read ${id} — ${apiError(r)}`);
        continue;
      }
      const p = r.json ?? {};
      const price = p.initial_price ?? p.renewal_price ?? null;
      const currency = (p.currency ?? "").toUpperCase();
      const oneTime = p.billing_type ? p.billing_type === "one_time" : undefined;
      const priceNote = price == null ? "price unknown" : `${currency} ${price}`;
      const wrongPrice = typeof price === "number" && Math.abs(price - expectedPrice) > 0.01;
      const preexisting = p.renewal_price && p.billing_type === "renewal";
      if (wrongPrice) record(`PLAN ${label}`, "INVALID", `${id} is ${priceNote}, expected $${expectedPrice}`);
      else if (preexisting || oneTime === false) record(`PLAN ${label}`, "INVALID", `${id} is recurring, should be one-time`);
      else record(`PLAN ${label}`, "PASS", `${id} ✓ ${priceNote}${oneTime ? " · one-time" : ""}`);
    } catch (e) {
      record(`PLAN ${label}`, "FAIL", `network: ${e.message}`);
    }
  }
}

/* ── Report ──────────────────────────────────────────────────────────────── */
const pad = (s, n) => String(s).padEnd(n);
const icon = { PASS: "✓", SET: "✓", OPTIONAL: "–", INVALID: "✗", FAIL: "✗", MISSING: "✗", BLOCKED: "‖" };

console.log("\nROOFSHIELD PRO — Whop preflight");
console.log(`API base: ${baseUrl}  ·  account: ${accountId || "(not set)"}`);
console.log("─".repeat(78));
for (const r of results) {
  console.log(`${icon[r.status] ?? "?"} ${pad(r.name, 28)} ${pad(r.status, 9)} ${r.detail}`);
}
console.log("─".repeat(78));

const blocking = results.filter((r) => ["MISSING", "INVALID", "FAIL"].includes(r.status));
const blocked = results.filter((r) => r.status === "BLOCKED");

if (blocking.length === 0 && blocked.length === 0) {
  console.log("RESULT: PASS — configuration validated against the live Whop API.");
  console.log("Next: submit the estimate form, open a service, start a deposit, then run");
  console.log("      curl -s http://localhost:3000/api/verify   (or the /status panel).");
  process.exit(0);
}

console.log(`RESULT: ${blocking.length} blocking issue(s), ${blocked.length} blocked check(s).`);
console.log("No secret values were printed. See WHOP_SETUP.md for exact steps.\n");
process.exit(1);
