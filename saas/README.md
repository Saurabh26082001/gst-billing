# GST Billing: hosted, paid version

This folder turns the GST billing app in `../_system` into a hosted service that you sell to businesses:

- **Accounts:** sign up, log in, log out (`/signup`, `/login`, the account button inside the app).
- **Pricing:** the first month is free with no card needed, then ₹99/month through Razorpay Subscriptions. A business that subscribes during the trial is first charged on the day the trial ends.
- **Isolation:** every business gets its own private copy of the billing server and its own books folder. One business can never see another's invoices.

The billing app itself is **not modified**. A gateway sits in front of it:

```
customer ──https──> Caddy / nginx ──> gateway.js ──> billing server for that business (127.0.0.1 only)
```

The gateway checks the login and the plan, then forwards requests. Desktop-only features are switched off because they must not run on a shared server: install/update/uninstall scripts, the control panel, and backups to an arbitrary server folder.

## Run it locally

Needs Node.js 22.13 or newer. There are no packages to install.

```bash
cp .env.example .env      # set PUBLIC_URL=http://localhost:8080 for local testing
npm start
```

Open http://localhost:8080 and sign up. Without Razorpay keys everything works except the Subscribe button.

## Set up Razorpay

1. Create a Razorpay account and complete KYC. Use **Test mode** first.
2. **Subscriptions → Plans → Create plan:** monthly, every 1 month, ₹99. Copy the `plan_…` id into `RAZORPAY_PLAN_ID`.
3. **Account & Settings → API Keys:** copy the key id and secret into `.env`.
4. **Webhooks → Add:**
   - URL: `https://<your domain>/__saas/razorpay/webhook`
   - Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`.
   - Events: `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`.

   Renewals are recorded only through the webhook, so this step is required.
5. Test with Razorpay's test cards or UPI, then switch to live keys.

### Access rules

A business can use the app while either of these holds:

- it is inside the free trial; or
- it has paid for the current month. After a failed renewal, access continues for `GRACE_DAYS` while Razorpay retries.

When neither holds, the app sends them to `/billing`. Their data is kept.

## Deploy

A small VPS is enough to start: 2 vCPU and 4 GB RAM handles roughly 30–40 businesses using the app at the same time. Run it in Mumbai or Bangalore for Indian customers.

```bash
# on the server, with the whole Free-GST-Billing folder copied over
cd saas && cp .env.example .env && nano .env
npm start                      # or run it under systemd / pm2
```

Caddy gives you HTTPS automatically. Example `Caddyfile`:

```
billing.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

### Back up `DATA_ROOT`

`DATA_ROOT` holds everything:

- `accounts.sqlite`: every account and subscription;
- `tenants/<user id>/`: each business's invoices, PDFs and the app's own daily backups.

Back it up off the server every day, for example with restic or rclone to object storage. Losing it means losing your customers' books.

## How it scales, and the limits

- **Memory:** each active business costs one Node process, about 60–100 MB. Idle ones stop after `INSTANCE_IDLE_MINUTES` and start again in about a second on their next request. `MAX_INSTANCES` caps how many run at once. Past a few hundred concurrently active businesses, spread tenants across several servers or rework the billing server to be multi-tenant.
- **Recurring invoices:** these are generated when a business's server is running. A business that hasn't opened the app gets them when it next opens it.
- **Password reset:** there is no self-service reset yet, because it needs an email provider. Until you add one, reset passwords by hand (see below).

### Reset a password

```bash
cd saas
node --disable-warning=ExperimentalWarning --input-type=module -e "
import { hashPassword } from './lib/auth.js'; import { db } from './lib/db.js';
db.prepare('UPDATE users SET password_hash=? WHERE email=?').run(await hashPassword(process.argv[1]), process.argv[2]); process.exit(0);
" 'NewPassword123' customer@example.com
```

## Licence

The billing app is MIT-licensed by DiceCodes. You may sell it, but you must keep its `LICENSE` file, including the copyright notice, with the code you deploy.
