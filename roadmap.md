### Roadmap to Implement a Secure Plasma Bot for Zenon

This roadmap outlines a phased plan to build a plasma bot that allows users to request plasma by fusing QSR (in tiers of 20, 80, or 120 QSR) from a backend-controlled wallet to their provided Zenon address. QSR remains fused until the wallet balance drops below 500 QSR, at which point the bot auto-unfuses the oldest fusions first (FIFO) until the balance recovers above 500 QSR. The architecture separates the frontend (browser-based UI) from the backend (Node.js API handling sensitive operations like wallet management and transactions). This ensures security by keeping private keys server-side.

Structured into phases with estimated timelines (assuming solo dev with part-time effort; adjust based on your experience/team). Total: 2-3 weeks. Prerequisites: Basic TypeScript/Node.js knowledge, familiarity with Zenon, and access to a VPS for deployment.

#### Phase 1: Planning & Research (1-2 days)
- **Goals**: Define requirements, research tools, and outline security best practices.
- **Steps**:
  1. Finalize specs:
     - Fuse: Tiered — Low (20 QSR), Medium (80 QSR), High (120 QSR) to user-provided address (validate as z1...).
     - Unfuse: Balance-threshold — unfuse oldest fusions first when wallet QSR < 500. Stop unfusing when balance >= 500 QSR.
     - Limits: Rate-limit 4 requests/24h per IP. One fuse per address (same address cannot request again while an active fusion exists).
     - Fees: Optional tiny ZNN donation to bot address for sustainability.
     - Monitoring: Log fusions, alert on low QSR balance. Critical alert when balance < 100 QSR.
  2. Research:
     - Zenon docs/explorer for plasma details (e.g., 10-hour lock period before unfusing, QSR token ID: zts1qsrxxxxxxxxxxxxxmrhjll).
     - SDK: znn-typescript-sdk v0.1.0-beta-3 from https://github.com/digitalSloth/znn-typescript-sdk (`npm install znn-typescript-sdk`). Key methods: plasma.fuse, plasma.getEntriesByAddress, plasma.cancel.
     - Security: Use SDK's built-in KeyFile which provides Argon2id + AES-256-GCM encryption. No need for custom encryption.
     - Inspirations: Study Zenon Hub's plasma bot (zenonhub.io/tools/plasma-bot) for UI/UX. Design inspired by SYRIUS wallet aesthetic.
  3. Tech stack:
     - Backend: Node.js + Express + TypeScript, znn-typescript-sdk, MongoDB with Mongoose for storing fusion jobs.
     - Frontend: Vite + React/TypeScript for simple form/status page.
     - Security: Helmet for HTTP headers, Zod for input validation, Cloudflare for anti-abuse (Turnstile/WAF in front of the app).
     - Logging: Winston with sensitive data redaction.
     - Other: Nodemailer for alerts, setInterval-based cron for scheduling.
  4. Budget: ~$5-10/month for VPS (e.g., DigitalOcean droplet), domain. MongoDB Atlas free tier (512MB) for database.
- **Deliverables**: Requirements doc, wireframe sketches, initial repo setup (GitHub private repo with .gitignore for secrets).

#### Phase 2: Backend Setup & Core Logic (3-5 days)
- **Goals**: Build the secure API that handles wallet, fusing, and scheduling.
- **Steps**:
  1. Project init: npm workspaces monorepo with backend/ and frontend/ packages. Install deps (`npm install znn-typescript-sdk express mongoose helmet cors zod winston`).
  2. Secure wallet management:
     - Use SDK's KeyFile (Argon2id + AES-256-GCM). Generate wallet offline, encrypt to keyfile JSON, transfer encrypted file to VPS.
     - Load keypair in memory only at app start from encrypted keyfile. Clear KEYFILE_PASSWORD from process.env after decryption.
     - Never persist decrypted keys. Mnemonic/private key never logged, never in API responses.
     - Fund wallet with QSR. Minimum recommended: 1000 QSR (500 threshold + buffer for active fusions).
  3. API endpoints:
     - POST /api/fuse: Validate address (z1... bech32), check rate limits (4/IP/24h + one per address), check wallet can afford fusion (balance - tier >= 500 QSR), fuse via SDK, store fusion record in MongoDB, return tx hash + tier + amount. Anti-abuse handled by Cloudflare (Turnstile/WAF) at the network edge.
     - GET /api/fusions/:address: Query active fusions/plasma for that address (merged from chain + local DB).
     - GET /api/fusions: Public list of all currently active fusions (for landing page table).
     - GET /api/stats: Public stats for landing page — QSR available to fuse, total QSR currently fused, active fusion count.
     - GET /api/health: Bot status, current QSR balance, active fusion count, node connection status.
  4. Scheduling:
     - Balance monitor cron (every 5 min): Check wallet QSR balance. If < 500 QSR, unfuse oldest fusions first (FIFO) until balance >= 500 QSR. Respect the 10-hour time lock — SDK's `isRevocable` flag on FusionEntry indicates whether a fusion can be cancelled. Skip non-revocable entries (retry next cycle).
     - Transaction serialization: Zenon requires sequential account blocks (each references the previous). Implement async mutex to prevent concurrent zenon.send() calls.
     - Auto-receive service: Cancelled fusions return QSR as unreceived blocks. Cron must call receiveAllPending() before checking balance.
     - Fusion ID reconciliation: zenon.send() returns tx_hash, but plasma.cancel() needs the on-chain FusionEntry.id (Hash). Reconcile by querying getEntriesByAddress and matching beneficiary + amount.
  5. Integrations:
     - Connect to Zenon node (wss://node.zenonhub.io:35998). SDK supports WebSocket auto-reconnect (added in v0.1.0-beta-3).
     - Add logging (Winston) with sensitive data redaction — never log mnemonics, keys, or passwords.
     - Startup health check: verify node connection, wallet decryption, and balance before accepting requests.
     - Graceful shutdown: wait for in-flight transactions, close WebSocket, close DB connection.
- **Security focus**: HTTPS (certbot), input validation (Zod), Helmet security headers, no key exposure in logs.
- **Deliverables**: Working local backend (test with Postman: send fuse request, verify tx on explorer.zenon.network).

#### Phase 3: Frontend Development (2-4 days)
- **Goals**: Create a user-friendly browser interface to interact with the API.
- **Steps**:
  1. Init: `npm create vite@latest` (React/TS template).
  2. Design direction — inspired by SYRIUS wallet (see image.png):
     - Dark background theme (deep navy/charcoal, e.g., #0a0a14 / #1a1a2e).
     - Neon green accent color (#00ff41 / #4caf50) for highlights, buttons, active states.
     - Monospace font for numbers and addresses (e.g., JetBrains Mono or Space Mono).
     - Card-based layout with subtle borders (green-tinted) and rounded corners.
     - Clean, minimal UI with generous spacing.
     - Green status badges and accent elements consistent with Zenon branding.
  3. UI components:
     - QSR Stats Banner: Two prominent stat cards at the top — "QSR Available" (wallet balance minus 500 threshold) and "QSR Fused" (total currently fused across all addresses). Monospace numbers, SYRIUS-style card layout. Auto-refreshes via /api/stats.
     - Form: Input for Zenon address (z1... validation), TierSelector (three cards for Low 20 QSR / Medium 80 QSR / High 120 QSR), submit button.
     - FusionTable: Public list of all active fusions below the form — columns: beneficiary address, QSR amount, date fused, tier. Auto-polls every 30s via React Query.
     - Status: Show tx hash and status badge (Active/Unfused) after submission.
     - Extras: FAQ section explaining plasma, wallet balance warning if low.
  4. API calls: Use @tanstack/react-query for data fetching with auto-polling. Fetch wrapper to hit backend API.
  5. Responsiveness: Tailwind CSS for mobile/desktop. Cards stack vertically on mobile.
- **Security**: No keys in frontend; all sensitive ops via API.
- **Deliverables**: Local dev server (test end-to-end: submit address → see fuse tx → see fusion in table).

#### Phase 4: Testing & Security Audit (2-3 days)
- **Goals**: Ensure reliability, security, and edge cases.
- **Steps**:
  1. Unit tests: Vitest for SDK calls, API endpoints (e.g., mock zenon.send). Test Zod schemas validate/reject correctly.
  2. Integration tests: Simulate full flow with small QSR amounts.
  3. Edge cases: Invalid address, insufficient QSR, network errors, multiple requests from same address, 5th IP request in 24h.
  4. Test FIFO unfuse order: seed DB with old fusions, mock low balance, verify oldest unfused first.
  5. Security scan: Run npm audit, check for OWASP top 10. Verify no keys in logs, rate limits enforced, CORS blocks other origins.
  6. Manual audit: Review code for key leaks.
- **Deliverables**: Test coverage report, bug fixes.

#### Phase 5: Deployment & Monitoring (1-2 days)
- **Goals**: Go live with ongoing ops.
- **Steps**:
  1. Backend deploy: PM2 for process management on VPS, nginx for reverse proxy/HTTPS.
  2. Frontend deploy: Same VPS via nginx — serve static files from frontend/dist, proxy /api/* to backend. Simpler than separate hosting, no CORS complexity.
  3. Environment: Encrypted keyfile at /etc/plasma-bot/wallet.json (chmod 600). KEYFILE_PASSWORD and MONGODB_URI via environment variables (systemd EnvironmentFile or PM2 ecosystem config, chmod 600).
  4. Monitoring: Health endpoint (/api/health), alerts via email if QSR < threshold.
  5. Launch: Test live, announce on X/Zenon forums if public.
- **Ongoing**: Monitor logs, refill QSR as needed, update SDK if new versions release.
- **Deliverables**: Deployed app with HTTPS, basic docs/readme.

#### Potential Risks & Mitigations
- **Cost**: QSR usage — mitigate with fees or donations.
- **Network changes**: Zenon updates — monitor via GitHub/Zenon Discord.
- **Abuse**: Cloudflare (Turnstile/WAF) + rate limits (4/IP/24h + one per address); block bad actors.
- **Legal**: Ensure compliance (e.g., no unregistered money services); consult if scaling.
- **Key compromise**: If VPS is breached, wallet keys are exposed. Mitigate with encrypted keyfile (Argon2id + AES-256-GCM), minimal file permissions (chmod 600), SSH key-only auth, firewall (only ports 80/443/SSH open), non-root service user.

This plan is actionable and scalable. Start with Phase 1, and prototype the backend first since it's the core. If you hit blockers (e.g., SDK issues), check the SDK repo issues or ask on Zenon Discord.
