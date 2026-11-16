# va_ca setup guide (go-live checklist)

Folder map: `server.js` (API), `adapters.js` (Razorpay, Turnstile, MSG91), `index.js` (start-up), `admin.js` (approve people/photos),
`frontend/` (the website, works in demo mode or live mode), `test.js test2.js e2e.js` (tests), `Dockerfile`, `render.yaml`, `.env.example`.

## Tests (run these any time)
`npm install` then `npm test` (18 security tests) and `npm run e2e` (real website talking to the real API: sign-up, approval,
like, payment, 7-day reveal, like-back, chat, logout).

## Go live: do these in order (each needs YOUR account, I cannot create them)
1. **Razorpay** (razorpay.com): create an account, stay in TEST mode first. Copy Key Id + Key Secret. Later add a Webhook:
   URL `https://<your-api>/webhooks/payment`, events `payment.captured` and `payment.failed`, and a secret you choose (16+ characters).
2. **MSG91** (msg91.com): create an account, finish DLT registration, get an OTP template approved, copy the Authkey and Template ID.
   (Check the variable name in your template; default is `OTP`, change with `MSG91_VAR`.)
3. **Cloudflare Turnstile** (free): create a widget, copy the Site key (for the website) and Secret key (for the API).
4. **Start the infra**: run `npm run db:up` to launch a local Postgres + Redis stack. This is the same schema that you will later point `DATABASE_URL` and `REDIS_URL` at in Render or Supabase.
5. **Host the API** on Render (or Railway/Fly) using `render.yaml` or the `Dockerfile`. It needs a persistent disk mounted at `/data`
   and exactly ONE instance. Fill in the variables from `.env.example`. Set `ORIGINS` to your website address.
6. **Build the website**: in `frontend/` run
   `node build.js --api https://<your-api> --turnstile <SITE_KEY> --razorpay`
   then upload the `dist` folder (index.html + vercel.json) to Vercel/Netlify.
7. **First admin**: open the website, sign up normally, then on the server run `node admin.js make-admin <your-mobile-number>`.
8. **Daily admin work** (on the server): `node admin.js pending` then `approve <id>` or `reject <id>`; `photos` then `approve-photo <id>`; `reports`.
9. Open the browser console on the live site once and check for "Content Security Policy" errors (the payment and CAPTCHA pop-ups
   need their own addresses allowed; `build.js` adds the ones I know of).

### Production database note
The app remains SQLite-first to keep the security tests and local demo stable. For beta hosting, point the deployment environment to a managed Postgres and keep Redis for shared rate limits and session state. The file `scripts/postgres-init.sql` is the starting schema for that step.

## What is verified vs. not
Verified by automated tests here: all 10 protections, the adapters (against mocked networks), the website in demo and live mode, the full journey.
**Not verified against the real services** (no accounts here): MSG91, Turnstile, Razorpay. The code follows their documented formats as far as
I know; test each in the provider's sandbox/test mode and check their current docs before real money or real SMS.

## Still manual or still open
- **GSTIN**: the format and checksum are checked and the admin sees any lookup result. A real "does this business exist" check needs a KYC provider:
  pass `kyc: async (gstin) => ({legalName, status})` to `createApp` in `index.js`. Until then the admin decides.
- **Photo moderation**: new photos wait for the admin. For automatic scanning pass `moderate: async (webpBuffer) => 'approve'|'reject'|'review'`
  (any nudity-detection service). Errors fall back to manual review.
- **Run one server only.** Rate limits live in memory. For 2+ servers move them to Redis, and move SQLite to Postgres.
- **Not built yet**: photo sharing inside chat, block/report buttons in the website (the API has them), email login, Google/Apple login,
  password reset, push notifications, refund handling.
- Tokens: the website keeps the short-lived access token in memory and the refresh token in the tab's session storage (cleared when the tab closes).
- Get a security review before launch. DPDP consent wording and the payment-aggregator question need a lawyer or CA.
