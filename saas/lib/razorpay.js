// Razorpay Subscriptions over its REST API (no SDK needed).
// Docs: https://razorpay.com/docs/api/payments/subscriptions/
import crypto from 'crypto';
import { config } from './config.js';

const API = 'https://api.razorpay.com/v1';

async function call(method, path, body) {
  const { keyId, keySecret } = config.razorpay;
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.description || `Razorpay ${method} ${path} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// startAt (seconds): the first charge. During the free trial it is the trial's
// end, so subscribing early never cuts the free month short.
export function createSubscription({ userId, email, startAt }) {
  return call('POST', '/subscriptions', {
    plan_id: config.razorpay.planId,
    total_count: 120, // 10 years of monthly renewals; Razorpay requires a count
    customer_notify: 1,
    ...(startAt ? { start_at: startAt } : {}),
    notes: { user_id: userId, email },
  });
}

export const fetchSubscription = (id) => call('GET', `/subscriptions/${encodeURIComponent(id)}`);

// Stops renewals; the period already paid for stays usable. A subscription
// whose first charge has not happened yet (still in the free month) has no
// cycle to finish, so it is cancelled straight away.
export const cancelSubscription = (id, atCycleEnd) =>
  call('POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Checkout's success callback: signature = HMAC(payment_id|subscription_id, key secret).
export const verifyCheckout = ({ paymentId, subscriptionId, signature }) =>
  safeEqualHex(hmac(config.razorpay.keySecret, `${paymentId}|${subscriptionId}`), signature);

// Webhook: X-Razorpay-Signature = HMAC(raw body, webhook secret).
export const verifyWebhook = (rawBody, signature) =>
  Boolean(config.razorpay.webhookSecret) && safeEqualHex(hmac(config.razorpay.webhookSecret, rawBody), signature);
