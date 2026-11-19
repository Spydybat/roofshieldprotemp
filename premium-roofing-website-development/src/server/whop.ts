import { WhopClient } from "@whop/sdk";

/**
 * Server-only Whop integration layer.
 *
 * Every function degrades honestly: when credentials are missing the caller
 * receives a structured `WHOP_NOT_CONFIGURED` result instead of a simulated
 * success. Secrets never leave the server.
 */

export interface WhopConfig {
  apiKey?: string;
  accountId?: string;
  productId?: string;
  baseUrl: string;
  webhookSecret?: string;
  adminToken?: string;
  plans: { inspection?: string; deposit?: string; gutter?: string };
}

export function getWhopConfig(): WhopConfig {
  return {
    apiKey: process.env.WHOP_API_KEY || undefined,
    accountId: process.env.WHOP_ACCOUNT_ID || undefined,
    productId: process.env.WHOP_PRODUCT_ID || undefined,
    baseUrl: process.env.WHOP_API_BASE_URL || "https://api.whop.com",
    webhookSecret: process.env.WHOP_WEBHOOK_SECRET || undefined,
    adminToken: process.env.ADMIN_TOKEN || undefined,
    plans: {
      inspection: process.env.WHOP_PLAN_ID_INSPECTION || undefined,
      deposit: process.env.WHOP_PLAN_ID_DEPOSIT || undefined,
      gutter: process.env.WHOP_PLAN_ID_GUTTER || undefined,
    },
  };
}

let _client: WhopClient | null | undefined;

export function getWhopClient(): WhopClient | null {
  if (_client !== undefined) return _client;
  const { apiKey, baseUrl } = getWhopConfig();
  // The SDK expects its base URL to INCLUDE the `/api/v1` segment (its built-in
  // default is `https://api.whop.com/api/v1`). Our `baseUrl` is the bare origin
  // (raw fetches append `/api/v1` themselves), so add the suffix here to avoid
  // 404s on every SDK call (checkout configs, setup intents, payments, invoices).
  const sdkBaseUrl = `${baseUrl.replace(/\/+$/, "")}/api/v1`;
  _client = apiKey ? new WhopClient({ token: apiKey, baseUrl: sdkBaseUrl, maxRetries: 1 }) : null;
  return _client;
}

/** Human-readable error message out of SDK/API errors. */
export function whopErrorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { message?: string; error?: { message?: string }; status?: number };
    const msg = e.error?.message ?? e.message;
    if (msg) return e.status ? `${msg} (HTTP ${e.status})` : msg;
  }
  return "Unexpected error contacting the Whop API.";
}

/** Which pieces of the integration are configured (safe to expose). */
export function whopConfigReport() {
  const c = getWhopConfig();
  return {
    apiKey: !!c.apiKey,
    accountId: !!c.accountId,
    productId: !!c.productId,
    planInspection: !!c.plans.inspection,
    planDeposit: !!c.plans.deposit,
    planGutter: !!c.plans.gutter,
    webhookSecret: !!c.webhookSecret,
    adminToken: !!c.adminToken,
    pixel: !!process.env.NEXT_PUBLIC_WHOP_PIXEL_SRC,
    accountIdValue: c.accountId ?? null,
    baseUrl: c.baseUrl,
    environment: process.env.NEXT_PUBLIC_WHOP_ENV === "sandbox" ? "sandbox" : "production",
  };
}

/** Lightweight authenticated ping used by the status page. */
export async function pingWhopApi(): Promise<{ ok: boolean; detail: string }> {
  const { apiKey, accountId, baseUrl } = getWhopConfig();
  if (!apiKey) return { ok: false, detail: "WHOP_API_KEY is not set" };
  try {
    const url = new URL(`${baseUrl}/api/v1/invoices`);
    url.searchParams.set("per_page", "1");
    if (accountId) url.searchParams.set("account_id", accountId);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    return res.ok
      ? { ok: true, detail: `Authenticated · HTTP ${res.status}` }
      : { ok: false, detail: `Whop API answered HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: whopErrorMessage(err) };
  }
}
