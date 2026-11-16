# Case study: making a prototype safe enough to trust

> Draft written for the project owner to edit. Replace anything that is not true for you, add your own story in the "My part" section, and keep the line saying the project was built with AI assistance.

## Summary
va_ca is a matching app for verified businesses and influencers with one unusual rule: an influencer pays once, and the likes they received are revealed only after a 7-day hold. I started with a visual prototype, then asked "how would a real customer or attacker break this?" and rebuilt the missing parts as a backend where those attacks fail, with tests to prove it.

## My part (fill this in)
- What I decided: the concept, the 7-day rule, the look (warm beige and brown with Instagram-style accents), which screens mattered.
- What I did with AI help: wrote the interface and API code, tests and documentation, reviewing and testing each step.
- What I learned: *(write 3 sentences in your own words)*

## The problem
A static prototype hides every hard question. Nothing stops someone from editing the page and showing "paid", changing the phone clock, or calling the API directly. So the real work was moving every rule from the screen to the server.

## Process
1. **Prototype first.** Six mobile screens (discover, profile, likes, chat, influencer home, payment) in a canvas, then a single clickable file.
2. **Break it on paper.** I listed ten ways a customer or attacker could abuse the app.
3. **Fix each one on the server** and write a test that tries the attack and must fail.
4. **Connect the real website** to the real API in "live mode" and test the whole journey with two simulated users.

## The ten threats and the fixes
| # | Attack | Fix |
|---|---|---|
| 1 | Show a fake "paid" screenshot or change the status in the app | Payment becomes paid **only** through a signed webhook (HMAC over the raw body), with amount check, freshness check and replay protection. The app can only read status. |
| 2 | Read likes early by calling the API or changing the phone date | The server sets `reveal_at` when payment is confirmed and uses only its own clock. Before that, the endpoint returns just `locked: true`: no likes, no count. |
| 3 | Change a user id in a request to read someone else's chat, likes or photos | The user always comes from the session token. Each object (chat, photo, payment, export) is checked for ownership. Not yours means 404. |
| 4 | Create a fake verified business | GSTIN format and checksum check, admin approval before any action, optional KYC lookup shown to the admin. |
| 5 | Brute-force or spam OTPs | Hashed codes, 5-minute expiry, 5 tries, single use, 30 s cooldown, per-phone and per-IP caps, CAPTCHA hook. |
| 6 | Upload a disguised or oversized file, or leak location through photo metadata | Real file-signature check, 5 MB cap, re-encode to WebP (strips EXIF), random file names, files not publicly served, moderation hook. |
| 7 | Spam, scam links, script injection in chat | Length limit, link flag, per-user rate limit, block and report, text stored and shown as plain text. |
| 8 | Scrape every profile | Login required, 20 items per page, per-user and per-IP rate limits, random IDs. |
| 9 | Steal an account (SIM swap, stolen token) | 15-minute access tokens, rotating refresh tokens, reuse detection (a replayed token logs out every session), log out everywhere, scrypt password hashing with lockout. |
| 10 | Keep data forever | Versioned consent at sign-up, data export, account deletion that erases personal data (payment records are kept for accounts and tax). |

## Testing approach
- **18 API tests** (Node test runner): each attack above, plus adapters tested against mocked networks.
- **14-step end-to-end test**: the real website file runs in a simulated browser against the real API. Two users sign up, an admin approves them, a like is sent, payment is confirmed by a signed webhook, 7 server-days pass, the like is revealed, they chat.
- A **CI workflow** runs both on every push.

## A bug the end-to-end test found
After the 7-day jump in the test, the access tokens had expired. Two requests fired at the same moment both got "401", and both tried to refresh with the **same** refresh token. The server correctly saw one of them as a replayed (stolen-looking) token and logged the user out of everything.
The server was right; the website was wrong. Fix: make refreshing **single-flight** in the browser (one refresh at a time, other requests wait and reuse the result). This is the kind of bug unit tests on the server alone would never show.

## Trade-offs I chose on purpose
- **Everything fails closed.** In production the server refuses to start without real SMS, CAPTCHA and payment settings, rather than quietly running in an insecure mode.
- **SQLite and in-memory rate limits** keep the project easy to run, but mean one server only. The next step is Postgres and Redis.
- **Manual review first.** Photos and verifications wait for an admin. Automatic checks can be plugged in later through hooks, and errors fall back to manual review.
- **No framework on the website.** Plain HTML and JavaScript kept the file small, easy to inspect and easy to give a strict content-security policy.

## Honest limits
- The Razorpay, MSG91 and Turnstile adapters follow documented formats but are **untested against the live services**.
- Not built: photo sharing in chat, block/report buttons in the website, email and social login, password reset, refunds.
- It has not had an independent security review or a penetration test.
- Money, user data and "paid reveal" features have legal rules in India; I would need a lawyer or CA before real launch.

## What I would do next
Test in the providers' sandboxes, add block/report to the website, move to Postgres and Redis, add automatic photo moderation, and run a short private beta with 20 to 50 verified users.

## Skills this shows
API design, authentication and sessions, threat modelling, webhook security, file-upload security, rate limiting, privacy-by-design, automated testing (unit, integration, end-to-end), CI, and honest scoping.
