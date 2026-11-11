// Everything the gateway reads from the environment, in one place.
// See .env.example for what each value means.
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

const publicUrl = new URL(env.PUBLIC_URL || `http://localhost:${env.PORT || 8080}`);

export const config = {
  port: Number(env.PORT) || 8080,
  host: env.HOST || '0.0.0.0',
  publicUrl,
  publicOrigin: publicUrl.origin,
  secureCookies: publicUrl.protocol === 'https:',
  trustProxy: env.TRUST_PROXY === '1',

  brandName: env.BRAND_NAME || 'GST Billing',
  supportEmail: env.SUPPORT_EMAIL || '',

  // The unchanged billing server (the _system folder) and where each
  // business's books are kept: <DATA_ROOT>/<user id>/data, Saved Invoices, Trash.
  billingAppDir: path.resolve(here, '..', env.BILLING_APP_DIR || '../_system'),
  dataRoot: path.resolve(here, '..', env.DATA_ROOT || './storage'),

  trialDays: Number(env.TRIAL_DAYS) || 30,
  pricePaise: Number(env.PRICE_PAISE) || 9900,
  // Days of access kept after a missed renewal while Razorpay retries the card.
  graceDays: Number(env.GRACE_DAYS ?? 3),
  sessionDays: Number(env.SESSION_DAYS) || 30,

  instanceIdleMinutes: Number(env.INSTANCE_IDLE_MINUTES) || 20,
  maxInstances: Number(env.MAX_INSTANCES) || 100,

  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || '',
    keySecret: env.RAZORPAY_KEY_SECRET || '',
    planId: env.RAZORPAY_PLAN_ID || '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
  },
};

export const paymentsConfigured = () =>
  Boolean(config.razorpay.keyId && config.razorpay.keySecret && config.razorpay.planId);
