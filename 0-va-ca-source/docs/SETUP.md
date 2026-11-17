# va_ca setup guide (go-live checklist)

Folder map: `server.js` (API), `database.js` (SQLite/Postgres adapter), `storage.js` (local/Supabase photo storage),
`adapters.js` (Razorpay, Turnstile, MSG91), `index.js` (start-up), `admin.js` (approve people/photos), `frontend/` (demo/live website),
`test.js test2.js e2e.js` (tests), `Dockerfile`, `render.yaml`, `.env.example`.

## Tests (run these any time)
`npm install` then `npm test` (20 security tests) and `npm run e2e` (real website talking to the real API: sign-up, approval,
like, payment, 7-day reveal, like-back, chat, logout).

## Go live: do these in order (each needs YOUR account, I cannot create them)
1. **MSG91** (msg91.com): create an account, finish DLT registration, get an OTP template approved, copy the Authkey and Template ID.
   (Check the variable name in your template; default is `OTP`, change with `MSG91_VAR`.)
2. **Cloudflare Turnstile** (free): create a widget, copy the Site key (for the website) and Secret key (for the API).
3. **Create a Supabase project** on the Free plan. Create a private Storage bucket named `va-ca-photos`, then copy the project URL,
   server-only service role key, and Postgres **Session Pooler** connection string (IPv4) into the matching Render variables.
   The production API initializes its schema from `scripts/postgres-init.sql`. Keep the service role key on the server only.
4. **Deploy the API to Render Free** from the repository using the root `Dockerfile` or `render.yaml`. Set `ORIGINS` to the exact
   website origin, then add all remaining production variables from `.env.example`. By default, production payments are disabled;
   the API refuses to start without `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`,
   `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `TURNSTILE_SECRET`, and `ORIGINS`. OTP/live authentication remains unavailable until MSG91
   is configured. Render Free sleeps after inactivity; its local filesystem is ephemeral, so the API stores photos in Supabase Storage
   and all persistent records in Supabase Postgres. Supabase Free has limited database/storage quotas and can pause projects after a week without activity.
5. **Build the website**: in `frontend/` run
   `node build.js --api https://<your-api> --turnstile <SITE_KEY>`
   then upload the `dist` folder (index.html + vercel.json) to Vercel/Netlify. This omits the payment checkout; the paid Reveal Week stays unavailable.
6. **Optional payments later**: add Razorpay TEST credentials and a `RAZORPAY_WEBHOOK_SECRET` (16+ characters) to Render, then set
   `ENABLE_PAYMENTS=true`. Add a Razorpay webhook at `https://<your-api>/webhooks/payment` for `payment.captured` and `payment.failed`;
   use the same webhook secret in both places. Rebuild the website with `--razorpay`.
7. **First admin**: open the website, sign up normally, then run `node admin.js make-admin <your-mobile-number>` locally with the same `DATABASE_URL` set.
8. **Daily admin work**: run `node admin.js pending` locally with the same `DATABASE_URL`; then `approve <id>` or `reject <id>`, `photos` then `approve-photo <id>`, or `reports`.
9. Open the browser console on the live site once and check for "Content Security Policy" errors (the CAPTCHA needs its own addresses allowed; `build.js` adds the ones it knows).

### Production database note
Tests and local development continue to use SQLite by default. When `DATABASE_URL` is set, the API uses Supabase Postgres; when the
Supabase Storage variables are set, uploaded WebP photos use a private Supabase bucket. Rate limits remain in memory, so run one API
instance. Supabase Free currently includes 500 MB of database and 1 GB of file storage, and projects may pause after one week idle;
check current plan limits before using real users.

## What is verified vs. not
Verified by automated tests here: all 10 protections, the adapters (against mocked networks), the website in demo and live mode, the full journey.
**Not verified against the real services** (no accounts here): MSG91, Turnstile, Razorpay. The code follows their documented formats as far as
I know; test each in the provider's sandbox/test mode and check their current docs before real money or real SMS.

## Still manual or still open
- **GSTIN**: the format and checksum are checked and the admin sees any lookup result. A real "does this business exist" check needs a KYC provider:
  pass `kyc: async (gstin) => ({legalName, status})` to `createApp` in `index.js`. Until then the admin decides.
- **Photo moderation**: new photos wait for the admin. For automatic scanning pass `moderate: async (webpBuffer) => 'approve'|'reject'|'review'`
  (any nudity-detection service). Errors fall back to manual review.
- **Run one API instance only.** Rate limits live in memory. Multiple replicas require shared rate-limit storage first.
- **Not built yet**: photo sharing inside chat, block/report buttons in the website (the API has them), email login, Google/Apple login,
  password reset, push notifications, refund handling.
- Tokens: the website keeps the short-lived access token in memory and the refresh token in the tab's session storage (cleared when the tab closes).
- Get a security review before launch. DPDP consent wording and the payment-aggregator question need a lawyer or CA.
