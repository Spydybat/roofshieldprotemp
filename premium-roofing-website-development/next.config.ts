import type { NextConfig } from "next";

/**
 * Whop Elements render in frames served from https://cdn.whop.com and talk to the
 * Whop API, so the Content-Security-Policy must allow them (see
 * https://docs.whop.com/elements → Content security policy).
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.whop.com https://pay.google.com https://applepay.cdn-apple.com https://js.braintreegateway.com https://www.paypal.com https://c.paypal.com https://assets.whop.com",
  "frame-src 'self' https://cdn.whop.com https://checkout.paypal.com https://assets.braintreegateway.com https://www.paypal.com https://www.sandbox.paypal.com https://cdn.plaid.com",
  "connect-src 'self' https://api.whop.com https://sandbox-api.whop.com https://pay.google.com https://google.com https://account.google.com https://www.google.com https://api.basistheory.com https://payments.braintree-api.com https://api.braintreegateway.com https://api-m.paypal.com https://api-m.sandbox.paypal.com https://www.paypal.com https://www.sandbox.paypal.com https://production.plaid.com https://sandbox.plaid.com",
  "img-src 'self' data: blob: https://www.paypalobjects.com https://cdn.whop.com https://assets.whop.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
    ];
  },
};

export default nextConfig;
