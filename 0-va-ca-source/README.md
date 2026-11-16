# va_ca

**A verified matching app for businesses and influencers.** Businesses like creators, creators pay once to unlock their likes after a 7-day hold, and a mutual like opens a chat.

> **Status: working prototype / portfolio project. Not live, no real users, no real payments.**
> Built with AI assistance (Claude). The SMS, CAPTCHA and payment adapters follow the providers' documented formats but have **not** been tested against the live services.
> The brand name "va_ca" is a placeholder.

[Live demo](https://claude.ai/artifact/TELhmJfrrGvDp3GACsJ6dd) (demo mode, no backend; the OTP is shown on screen) · [Case study](docs/CASE_STUDY.md) · [Go-live checklist](docs/SETUP.md)

<!-- After you add screenshots (see docs/SCREENSHOTS.md), remove this comment and add:
| Log in / Sign up | Discover | Chat | Payment |
|---|---|---|---|
| ![](docs/screens/01-login.png) | ![](docs/screens/02-discover.png) | ![](docs/screens/04-chat.png) | ![](docs/screens/06-payment.png) |
-->

## How it works
1. A business signs up with mobile OTP (or password) and its GSTIN. An admin approves it.
2. Approved businesses browse verified influencers and send likes.
3. An influencer pays once. The **server** starts a 7-day timer. Until it ends, the influencer's app receives nothing about who liked them (not even a count).
4. After 7 days the likes are revealed. A like back opens a chat for both sides.

## Architecture
```mermaid
flowchart LR
  W[Website<br/>static HTML + JS] -->|HTTPS, Bearer token| A[Node + Express API]
  A --> D[(SQLite)]
  A --> P[Photo files<br/>re-encoded WebP]
  A -.OTP SMS.-> M[MSG91]
  A -.CAPTCHA check.-> T[Cloudflare Turnstile]
  R[Razorpay] -- signed webhook --> A
```
Stack: Node 22, Express, built-in SQLite, sharp, plain HTML/CSS/JS (no framework) for the website. Two modes: **demo** (no backend, everything simulated) and **live** (talks to the API).

## Security work (the main point of this project)
| Risk | What the server does | Test |
|---|---|---|
| Fake "I paid" | Only a **signed webhook** can mark a payment paid. Wrong signature, wrong amount, stale or repeated events are rejected. | `test.js` 1 |
| Breaking the 7-day hold | Server clock only. Locked responses contain no like data. Phone clock and headers are ignored. | `test.js` 2 |
| Reading other people's data | The user comes from the session token, never from the request. Every chat, photo and payment is checked per object. | `test.js` 3 |
| Fake verified profiles | GSTIN format + checksum, admin approval required for every action. | `test.js` 4 |
| OTP abuse | Hashed, 5-minute expiry, 5 tries, single use, 30 s cooldown, hourly caps, CAPTCHA. | `test.js` 5 |
| Dangerous uploads | Real file-type check, 5 MB cap, re-encoded to WebP (removes EXIF/GPS), random names, admin or hook moderation. | `test.js` 6 |
| Chat spam and scams | Length limits, link flags, rate limit, block, report, plain-text rendering. | `test.js` 7 |
| Scraping | Login required, 20 per page, rate limits, random IDs. | `test.js` 8 |
| Account theft | 15-minute access tokens, rotating refresh tokens with reuse detection, log out everywhere, scrypt passwords. | `test.js` 9, 9b |
| Privacy | Versioned consent, data export, account deletion that erases personal data. | `test.js` 10 |

Details and one real bug the end-to-end test caught: [docs/CASE_STUDY.md](docs/CASE_STUDY.md).

## Run it
```bash
npm install
npm test          # 18 security tests (API, adapters, hooks)
npm run e2e       # 14-step journey: real website <-> real API, two users
# dev server (OTP is printed in the terminal, no SMS is sent):
SECRET="$(openssl rand -hex 24)" WEBHOOK_SECRET="$(openssl rand -hex 12)" node index.js
```
Open `frontend/index.html` for demo mode. For live mode build the site with `node frontend/build.js --api http://localhost:3000`.

## Production-ready hosting path
This prototype is already working locally, and the fastest next step is to move it into a hosted stack without breaking the demo flow.

### Option A: Render + Postgres + Redis
1. Start local services:
   ```bash
   npm run db:up
   ```
2. Set your environment variables from `.env.example` and point `DATABASE_URL` to the Postgres container.
3. Deploy the API to Render (or Fly/Railway) using the existing `render.yaml` and `Dockerfile`.
4. Host the frontend on Vercel and set the `ORIGINS` env var to the exact website origin.

Recommended startup values:
- `DATABASE_URL=postgres://va_ca:va_ca@localhost:5432/va_ca`
- `REDIS_URL=redis://localhost:6379`

### Option B: Supabase/Postgres for beta
- Use Supabase or a managed Postgres instance for the user, payment, and chat data.
- Keep the current SQLite flow for local development and tests.
- Move rate-limit state to Redis before running more than one API instance.

## Not built yet
Photo sharing inside chat, block/report buttons in the website (the API has them), email / Google / Apple login, password reset, refunds, notifications. Rate limits are in memory and SQLite is one file, so run a single server. Moving to Redis + Postgres is the scaling step.

## Disclaimer
Charging influencers to see likes, handling money between users, and storing personal data all have legal rules (payment-aggregator rules, DPDP Act consent). Get advice from a lawyer or CA before launching for real. No license is attached yet; choose one before making the repo public.
