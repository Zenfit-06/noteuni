# Noteversity → Vercel production deployment + admin-only auth

**Note:** MongoDB Atlas (cloud-hosted MongoDB — what the app already uses, NOT Firebase) is the one prerequisite you must create; free M0 tier is sufficient.

## Hard architecture facts (why changes are needed)
The app today is a persistent Express server with: embedded in-memory MongoDB fallback, runtime JSON-file persistence, a 105MB disk PDF library that RAG reads from disk, and Socket.io. All four are incompatible with Vercel serverless (ephemeral, read-only filesystem; no sockets). Per your instruction I'm implementing the cleanest Vercel-compatible architecture with minimal rewrites — the UI and features you use daily stay as they are.

## 1. Vercel architecture
- **Split `server.js` → `app.js` + `server.js`:** `app.js` = the Express app (all routes, no listen, no socket.io). `server.js` = dev-only bootstrap (http listen) so `start.bat`/local workflow is unchanged. Socket.io deleted everywhere (frontend never used it — audit-confirmed).
- **NEW `api/index.js`:** Vercel serverless entry exporting the Express handler; memoized `connectDB()` per lambda instance.
- **NEW `vercel.json`:** rewrites `/api/(.*)` and `/uploads/(.*)` → the function, `/` → the HTML (static); security headers (below); `maxDuration: 60` for the API function (AI answers take 10–40s; the 10s default would time out).
- **`config/db.js`:** production = `MONGO_URI` required, connect failure = fail fast (no memory server); dev keeps the zero-setup embedded Mongo. Credentials masked in logs.
- **Runtime JSON persistence (`data/*.json`):** disabled in production (Mongo is the source of truth); kept in dev.

## 2. PDF library → MongoDB GridFS (your choice)
- **NEW `services/storage.js`:** one interface — `putPdf/getPdfStream/deletePdf`. Disk mode (dev, unchanged) vs GridFS mode (production). Multer → memoryStorage; admin uploads go to GridFS + extract text at upload time.
- **`Note`/`Pyq` schemas gain `extractedText`** (capped ~120KB, extracted once at seed/upload). **RAG reads `extractedText` from Mongo instead of parsing PDFs per request** — faster answers, no disk access.
- **`/uploads/:filename` auth route** streams from GridFS in prod / disk in dev — auth gating preserved (unlike Vercel Blob's public URLs).
- **NEW `scripts/sync-cloud.js`:** run once locally with `MONGO_URI=<atlas-uri>` — uploads all 78 PDFs to GridFS, extracts text, seeds notes/PYQs/users. Idempotent.

## 3. Admin-only auth (no user accounts)
- **Removed entirely:** OTP request/verify, signup, user-login routes + `config/mailer.js` (dead code, live attack surface, logged OTP codes to console), `nodemailer`/`socket.io` deps, hardcoded `admin123`, Message room model/route.
- **Kept:** anonymous guest sessions (no credentials, no profile — an invisible per-browser ID so chat history and download stats work; public site stays 100% login-free).
- **Admin login:** `POST /api/auth/admin/login {password}` → bcrypt-compare against `ADMIN_PASSWORD_HASH` env (generic errors, never logged) → sets **`nv_admin` HttpOnly, Secure (prod), SameSite=Strict cookie** with a signed JWT (typ:admin, 8h expiry). Logout endpoint clears it. `GET /api/auth/me` returns guest/admin identity from cookies.
- **Guest sessions become cookie-based too** (`nv_session`, HttpOnly, 7d): **zero auth tokens in localStorage anywhere**; API calls, preview iframe, and downloads send cookies automatically (same-origin). `?token=` URLs removed from the frontend.
- **`middleware/admin.js`:** every admin API (upload/delete notes & PYQs) independently verifies the admin cookie server-side — guest tokens rejected by type check; knowing frontend routes grants nothing.
- **Frontend:** 🛡️ modal → new admin login endpoint; "Exit Admin Mode" → logout → falls back to the still-valid guest cookie (no token juggling).
- **JWT_SECRET:** all 5 hardcoded fallbacks replaced by one `config/env.js` helper that **refuses to boot in production without it**.

## 4. Security headers (vercel.json, tuned to not break the app)
CSP `default-src 'self'; script-src 'self' 'unsafe-inline' cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' fonts.googleapis.com cdn.jsdelivr.net; font-src fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src 'self' about:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'` + X-Content-Type-Options, Referrer-Policy, X-Frame-Options: SAMEORIGIN (preview iframe is same-origin — compatible), Permissions-Policy, HSTS. App uses only these CDNs (audit-verified: Google Fonts + jsDelivr KaTeX + data: favicon).

## 5. Rate limiting & input hardening
In-memory limiter on admin login (5 tries / 15 min / IP → 429; bcrypt adds natural delay; per-warm-instance caveat documented). ObjectId validation on delete/download routes (400 not 500). Existing upload validation carries over. Gemini calls get a ~50s abort guard so lambdas never hit the 60s wall mid-generation.

## 6. Environment variables
Server-only (Vercel dashboard, never in frontend/git): `MONGO_URI`, `JWT_SECRET`, `ADMIN_PASSWORD_HASH` (generate: `node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD',10))"`), `GEMINI_API_KEY`, optional `XAI_API_KEY`, `GEMINI_MODEL`, `XAI_MODEL`. Removed: SMTP_*, OTP_*, ALLOWED_EMAIL_DOMAIN, CLIENT_URL. Public: none — frontend needs zero config (same-origin). `.env.example` rewritten with placeholders; real `.env` stays gitignored; no real secret values will be printed in the report.

## 7. Files
- **New:** `api/index.js`, `vercel.json`, `noteversity-backend/app.js`, `services/storage.js`, `scripts/sync-cloud.js`, `config/env.js`
- **Modified:** `server.js`, `config/db.js`, `config/seeder.js`, `middleware/auth.js`, `middleware/admin.js`, `middleware/upload.js`, `routes/auth.js`, `routes/notes.js`, `routes/pyqs.js`, `routes/chat.js`, `services/aiService.js`, `services/jsonStore.js`, `models/Note.js`, `models/Pyq.js`, `models/User.js`, `noteversity-prototype.html`, `package.json`, `.env.example`, `README.md`
- **Removed:** `config/mailer.js`, `models/Message.js` + legacy room route, socket.io/otp/signup code paths

## 8. Testing before handoff (local, full bypass matrix)
1. Dev boot: notes/preview/download/chat/memory/chips all work cookie-based.
2. curl attack matrix: admin APIs without/with-guest/tampered/garbage cookie → 401/403; brute-force login → 429; logout kills access; old signup/OTP/login endpoints → 404; malformed bodies → 400; invalid IDs → 400; `/uploads` without session → 401.
3. Browser pass: fresh visitor → site fully usable with no login; localStorage contains no tokens; admin login → upload/delete appear → preview/download → logout → guest again.
4. Production-mode boot check: `NODE_ENV=production` without `MONGO_URI`/`JWT_SECRET` fails fast and cleanly.
5. Honest limit: I can't create your Vercel project or Atlas cluster from here. Everything is verified locally; you deploy (steps below), then hand me the live URL and I'll run the full attack-matrix re-run against the real deployment.

## 9. Exact deployment steps (also added to README)
1. Create free Atlas cluster → copy connection string → allow access from 0.0.0.0/0 (Vercel IPs are dynamic).
2. Locally: `MONGO_URI=<atlas-uri> node scripts/sync-cloud.js` (uploads PDFs + seeds; ~2–3 min).
3. Generate `ADMIN_PASSWORD_HASH` + a random `JWT_SECRET`.
4. Push repo to GitHub → Vercel dashboard → Import → framework: Other, no build command → add env vars (Production) → Deploy.
5. Open the URL (site loads, auto-guest), log in via 🛡️, ask the AI a question — then give me the URL for the production attack-matrix re-run.