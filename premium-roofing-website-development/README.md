# RoofShield Pro — Premium Roofing Website on Whop

A production-grade, reusable website template for US roofing companies. Luxury-editorial
design (oversized condensed typography, rounded imagery, glassmorphism, scroll reveals)
backed by **real Whop integrations**: Payment Elements checkout, setup-intent card-on-file
deposits, final-balance invoices, the Leads API, and pixel tracking.

## Stack

- **Next.js (App Router) + React 19 + TypeScript + Tailwind CSS v4**
- **PostgreSQL + Drizzle ORM** (lead/audit records, webhook log, projects, invoices)
- **@whop/sdk** — server-side Whop API (leads, checkout configurations, setup intents, payments, invoices, webhook verification)
- **@whop/elements + @whop/elements-react** — hosted `CheckoutElement`, `ExpressCheckoutElement`, `BrandingElement`
- No Stripe, no PayPal, no custom card forms — every payment surface is Whop-hosted.

## Re-skin in one file

All business content lives in **`src/config/site.ts`**: brand, navigation, hero copy,
services, service areas, projects, testimonials, pricing display and the plan-key mapping.
Plan IDs themselves come from environment variables.

## Environment

Copy `.env.example` → `.env.local` and fill in values from the Whop dashboard:

| Variable | Purpose |
| --- | --- |
| `WHOP_API_KEY` | Server-only key for all Whop API calls |
| `WHOP_ACCOUNT_ID` | `biz_…` company |
| `WHOP_PLAN_ID_INSPECTION` / `_DEPOSIT` / `_GUTTER` | `plan_…` one-time plans ($149 / $500 / $299) |
| `WHOP_PRODUCT_ID` | Optional `prod_…` attached to leads |
| `WHOP_WEBHOOK_SECRET` | `ws_…` signature secret for `/api/webhooks/whop` |
| `ADMIN_TOKEN` | Guards the final-balance invoicing console (`/status`) |
| `WHOP_API_BASE_URL` | `https://api.whop.com` (or sandbox API when enabled) |
| `NEXT_PUBLIC_WHOP_PIXEL_SRC` | Manual pixel snippet URL for self-hosting (auto-injected on Whop hosting) |
| `NEXT_PUBLIC_WHOP_ENV` | `production` or `sandbox` for Elements |

## Whop flows implemented

1. **Plan checkouts** — Pricing → modal → `CheckoutElement` (card) / `ExpressCheckoutElement`
   (wallets) + mandatory `BrandingElement`. Sessions are minted by Whop from the plan ID.
2. **$500 deposit + card on file** — `deposit_started` event → server creates a
   `checkoutConfiguration` in **`setup` mode** → buyer consents explicitly and saves the card
   (setup intent) → server charges the deposit plan to the saved `payt_…` method
   (`payments.create`, off-session, idempotent per setup intent).
3. **Final balance** — `/status` admin console → `invoices.create` → `invoices.issue`
   (auto-charge the consented card, `charge_automatically`) or `invoices.send`
   (email pay link). Whop's returned status is shown verbatim — nothing is prefaced as paid.
4. **Estimate form** — server-validated, then a real Lead via `client.leads.create`
   (`POST /api/v1/leads`). On success the site fires `whop.track('estimate_requested')`.
5. **Tracking** — `whop.track` wrapper in `src/lib/track.ts`; events: `estimate_requested`,
   `service_viewed` (service modal open), `deposit_started` (deposit checkout open). Every
   call is mirrored to Postgres so it is independently verifiable on `/status`.
6. **Webhooks** — `/api/webhooks/whop` verifies Standard Webhooks signatures and records
   `payment.succeeded`, `setup_intent.succeeded`, invoice events.

## Develop

```bash
npm install
npx drizzle-kit push     # create tables
npm run dev
```

## Deploy to Whop Websites

```bash
npx @whop/cli@latest apps deploy --app <your-app>   # after `whop login`
```

Set the env vars above in the app's dashboard and add the webhook endpoint
`https://<your-domain>/api/webhooks/whop`. See `COMPLETION_REPORT.md` for the
requirement-by-requirement verification status.
