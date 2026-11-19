# Whop Account Integration — Setup & Verification Runbook

Everything needed to take RoofShield Pro from code-complete to verified against a real
Whop account. Nothing here is a secret; **never commit real values.**

Run the automated audit at any point:

```bash
node scripts/whop-preflight.mjs
```

It checks presence/format, then proves the credentials with read-only API calls
(leads, invoices, events, and each plan ID). It never prints a secret — only
present/absent and length.

---

## 1. Every environment variable

### Required for the full integration

| Variable | Format | Used by | What it does |
|---|---|---|---|
| `WHOP_API_KEY` | opaque, `Bearer` | `src/server/whop.ts` | **Server-only.** Authenticates every Whop API call (leads, setup intents, payments, invoices, events). |
| `WHOP_ACCOUNT_ID` | `biz_…` | leads, checkout config, invoices, events | The company these records belong to. |
| `WHOP_PLAN_ID_INSPECTION` | `plan_…` | pricing card 1, `/api/checkout-sessions` | $149 one-time Roof Inspection plan. |
| `WHOP_PLAN_ID_DEPOSIT` | `plan_…` | pricing card 2, deposit charge | $500 one-time Roofing Project Deposit plan. |
| `WHOP_PLAN_ID_GUTTER` | `plan_…` | pricing card 3 | $299 one-time Gutter Cleaning plan. |
| `ADMIN_TOKEN` | random 32+ chars | `/api/invoices` | Bearer secret guarding final-balance invoice creation (the `x-admin-token` header). |

### Required for specific features

| Variable | Format | Used by | What it does |
|---|---|---|---|
| `WHOP_PRODUCT_ID` | `prod_…` | `/api/leads` | Optional but recommended: associates each lead with a product for reporting. |
| `WHOP_WEBHOOK_SECRET` | `ws_…` | `/api/webhooks/whop` | Verifies Standard Webhooks signatures so `payment.succeeded` / `setup_intent.succeeded` are trusted. Without it the webhook returns 503 and project status only advances via the synchronous API response. |
| `WHOP_API_BASE_URL` | URL | `src/server/whop.ts` | `https://api.whop.com` (default). Only change for a sandbox API host. |
| `NEXT_PUBLIC_WHOP_ENV` | `production` \| `sandbox` | Elements | Which environment the hosted checkout frames talk to. **Build-time inlined.** |
| `NEXT_PUBLIC_WHOP_PIXEL_SRC` | URL | `layout.tsx` | Only for self-hosting. On `whop.app` hosting Whop injects the pixel automatically — leave empty. |
| `NEXT_PUBLIC_SITE_URL` | URL | metadata, event `url` | Canonical origin, e.g. `https://roofshield.whop.app`. |

### Infrastructure (already configured in this sandbox)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres for the lead/event/project/invoice audit tables. |

> Deliberately **not** used: there is no `NEXT_PUBLIC_WHOP_API_KEY`. The API key must
> never reach the browser; the preflight fails loudly if such a variable exists.

---

## 2. Exact credentials and permissions

Create the key at **whop.com/dashboard → Developers → API keys** (account-scoped key).

| Capability | Endpoint used | Permission scopes |
|---|---|---|
| Create + re-read leads | `POST /api/v1/leads`, `GET /api/v1/leads/{id}` | `lead:manage`, `member:basic:read`, `member:email:read`, `access_pass:basic:read` |
| Checkout configurations (setup mode) | `POST /api/v1/checkout_configurations` | `plan:basic:read`, `access_pass:basic:read` |
| Retrieve setup intent | `GET /api/v1/setup_intents/{id}` | `payment:setup_intent:read`, `member:basic:read`, `member:email:read` |
| Charge the $500 deposit to the saved card | `POST /api/v1/payments` | `payment:charge`, `plan:basic:read`, `access_pass:basic:read`, `member:basic:read`, `member:email:read`, `member:phone:read`, `promo_code:basic:read`, `shipment:basic:read`, `plan:create`*, `access_pass:create`*, `access_pass:update`*, `payment:dispute:read`, `payment:resolution_center_case:read` |
| Create / issue / send final invoices | `POST /api/v1/invoices`, `POST /api/v1/invoices/{id}/issue`, `.../send` | `invoice:create`, `member:basic:read`, `member:email:read`, `payment:basic:read` |
| Forward tracking events server-side | `POST /api/v1/events` | `event:create` |
| Read events back for verification | `GET /api/v1/events` | events/analytics read (same key family; verify in dashboard) |
| Validate each plan ID | `GET /api/v1/plans/{id}` | `plan:basic:read` |

\* Only needed if you ever let the API create inline variants instead of using the three
pre-created plans. The three fixed plans do not require them.

**Also required in the dashboard (not env vars):**

1. **Three one-time plans** — Products → create product → add one-time plans at
   $149 / $500 / $299. Copy each `plan_…` ID.
2. **Payments enabled** on the account (KYC complete) so Payment Elements can render.
3. **Webhook endpoint** `https://<your-domain>/api/webhooks/whop` subscribed to
   `payment.succeeded`, `setup_intent.succeeded`, `invoice.paid`, `invoice.past_due`.
   Copy the `ws_…` signing secret.
4. **Wallet domains** — for Apple Pay / Google Pay in Express Checkout, register the
   production domain in the Whop payments settings.

---

## 3. Configuring secrets securely in the AI builder environment

**Preferred — the builder's secret manager.** Add each variable through the
environment/secrets UI for the project (not in a committed file). The platform injects
them as server-side `process.env` at build and runtime. Only values you *intend* to ship
to the browser may use the `NEXT_PUBLIC_` prefix.

**Local development** — create `.env.local` (git-ignored) from the committed template:

```bash
cp .env.example .env.local
# then edit .env.local with your real values
```

Rules this project already follows:

- Secrets are read only in `src/server/*`, route handlers, and server components.
  `src/server/whop.ts` and `src/server/whop-events.ts` are never imported by a client
  component.
- `/api/status` exposes only booleans (`apiKey: true/false`), never values.
- The preflight script prints only presence, length, and non-secret identifier prefixes.
- `NEXT_PUBLIC_WHOP_ENV` is inlined at build time — changing it requires a rebuild.
- Rotate `WHOP_API_KEY` and `ADMIN_TOKEN` immediately if either is ever pasted into a
  chat, log, or commit.

---

## 4. Verification procedure (run after configuring)

```bash
node scripts/whop-preflight.mjs      # credentials + plan IDs
npm run build && npm start           # or the builder's preview
```

Then, in the UI:

| # | Action | What to check |
|---|---|---|
| 1 | `/status` panel | Env rows turn green; **Re-run verification** |
| 2 | Submit the estimate form | Success state shows a real `lead_…` ID |
| 3 | Filter Whop dashboard → Leads | The lead exists with the metadata (`service_type`, ZIP…) |
| 4 | `curl -s localhost:3000/api/verify` | `leads.verdict = PASS` (re-read from Whop) |
| 5 | Open any service card → Explore Service | `service_viewed` fires |
| 6 | Pricing → Pay Deposit | `deposit_started` fires, then complete the sandbox checkout |
| 7 | `/status` → Re-run verification | All three events `PASS` |
| 8 | `/checkout/test` | Enter plan + account ID → Checkout, Express, Branding elements render |
| 9 | After deposit: `/status` → admin console → create invoice | `inv_…` returned; status shown verbatim |

Events are sent twice by design — `whop.track` in the browser and `events.create` from
the server with the **same `event_id`** — which Whop explicitly collapses into one event
("avoid duplicate events"). That makes them dashboard-verifiable even with no pixel.

---

## 5. Sandbox checkout note

Whop's docs state the Elements `sandbox` environment "is not yet generally available."
If your account does not have sandbox access:

- The buyer-side test in `/checkout/test` must use **your own live account** with a real
  card (small amount, refunded by you), or
- Use the Whop dashboard's own test-mode tooling if enabled for the account.

This is a **platform availability** constraint, not a code defect — the same code path
serves both environments via `NEXT_PUBLIC_WHOP_ENV`.

---

## 6. Deployment to whop.app (only after the checks above pass)

```bash
npx @whop/cli@latest login
npx @whop/cli@latest apps init        # first time: links/creates the app
npx @whop/cli@latest apps deploy      # publishes to <app>.whop.app
```

Set the same environment variables in the app's dashboard **before** the first deploy,
add the webhook URL, and confirm `/api/health` and `/status` on the deployed host.

This sandbox has no Whop login, so **the deploy step itself is BLOCKED here** — it must be
run from an environment where you are authenticated as the account owner.

---

## VERIFIED PLATFORM CHANGES (live, 2026-11-14)

These were confirmed against the live API with your credentials and required code changes:

### 1. The Whop Leads API is retired
```
POST /api/v1/leads  →  HTTP 410 Gone
"Creating leads is no longer available. To add someone who hasn't bought anything yet,
 call POST /api/v1/members with {"email": "...", "name": "..."}."
```
- `POST /api/v1/members` → **HTTP 201**, returns `mber_…` (verified).
- `GET  /api/v1/members/{id}` → **HTTP 200** (verified).
- `metadata` is **rejected** by this endpoint ("Unsupported fields: metadata"), so the full
  estimate payload is stored in the app's `leads` table and linked by the member id.
- Implementation: `src/server/whop-members.ts`; `/api/leads` now captures leads there.

### 2. Events API: send works, listing does not expose custom events
- `POST /api/v1/events` → **HTTP 200**, returns `"<biz_id>:<event_id>"` (verified for all
  three event names).
- `GET  /api/v1/events` → **HTTP 200** but returns only pixel-originated
  `page.dashboard.view` rows. Custom server events did **not** appear even after a 75s
  ingestion wait, with `user.email` and `user.member_id` attached.
- `GET /api/v1/events` **requires** `from`/`to` ISO timestamps when `identifier` is omitted.
- Consequence: `/api/verify` reports these events as **BLOCKED** (sent, not independently
  readable back) rather than PASS. Confirm receipt in the Whop dashboard's pixel/events
  view — that is the authoritative surface for custom events.
- The `@whop/sdk` events client returns 404 against the current API, so
  `src/server/whop-events.ts` calls the documented endpoints directly.

### 3. Probe records created during verification
These test members now exist in your account and should be deleted from the dashboard:
`preflight-probe@example.com`, `preflight-probe2@example.com`,
`preflight-retrieve@example.com`, `verify-test@roofshield-demo.example`,
`dup-check@roofshield-demo.example`.
(The API's DELETE on members returns 404, so removal must be done in the dashboard.)
