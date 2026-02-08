# Plasma Bot

A self-hosted bot for the [Zenon Network](https://zenon.network) that fuses QSR to provide plasma for users. Users request plasma through a web interface, and the bot automatically manages fusing, unfusing, and balance thresholds.

## How It Works

- Users submit their Zenon address and select a plasma tier (20, 80, or 120 QSR)
- The bot fuses QSR from its wallet to the user's address, providing plasma
- When the wallet balance drops below a configurable threshold, the bot automatically unfuses the oldest fusions (FIFO) to reclaim QSR
- Rate limiting prevents abuse: 4 requests per IP per 24 hours, one active fusion per address

## Architecture

```
┌─────────────────────────────────────┐
│         DigitalOcean VPS            │
│                                     │
│  Caddy (reverse proxy + auto SSL)   │
│    ├─ /        → frontend (static)  │
│    └─ /api/*   → backend:3001       │
│                                     │
│  Backend (Node.js/Express)          │
│    └─ connects to MongoDB + Zenon   │
│                                     │
│  MongoDB (persistent volume)        │
└─────────────────────────────────────┘
```

- **Backend**: Node.js + Express + TypeScript. Manages wallet, fusing/unfusing, balance monitoring.
- **Frontend**: React + Vite + Tailwind CSS. Single-page app with stats, fuse form, and fusion table.
- **Database**: MongoDB for fusion records and request auditing.
- **Reverse Proxy**: Caddy with automatic HTTPS via Let's Encrypt.

## Local Development

### Prerequisites

- Node.js 22+
- MongoDB (local or Docker: `docker run -d -p 27017:27017 mongo:7`)
- An encrypted Zenon wallet keyfile

### Setup

```bash
# Clone the repo
git clone https://github.com/0x3639/plasma.bot.git
cd plasma.bot

# Install dependencies
npm install

# Copy environment template
cp .env.example backend/.env
# Edit backend/.env with your wallet path, password, and MongoDB URI

# Start backend (watches for changes)
npm run dev --workspace=backend

# Start frontend (in another terminal)
npm run dev --workspace=frontend
```

The frontend dev server runs on `http://localhost:5173` and proxies `/api/*` to the backend on port 3001.

### Running Tests

```bash
npm test --workspace=backend          # Run once
npm run test:watch --workspace=backend # Watch mode
npm run test:coverage --workspace=backend # With coverage
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend server port | `3001` |
| `NODE_ENV` | `development` or `production` | `development` |
| `FRONTEND_URL` | Frontend origin for CORS | `http://localhost:5173` |
| `ZNN_NODE_URL` | Zenon node WebSocket URL | `wss://node.zenonhub.io:35998` |
| `KEYFILE_PATH` | Path to encrypted wallet keyfile | `/etc/plasma-bot/wallet.json` |
| `KEYFILE_PASSWORD` | Wallet decryption password | (required) |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/plasma-bot` |
| `ADMIN_API_KEY` | API key for admin endpoints | (disabled if empty) |
| `RATE_LIMIT_PER_IP_MAX` | Max fuse requests per IP per 24h | `4` |
| `BALANCE_THRESHOLD_QSR` | QSR balance that triggers unfusing | `500` |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/fuse` | Request a plasma fusion |
| `GET` | `/api/fusions` | List all active fusions (paginated) |
| `GET` | `/api/fusions/:address` | Fusions for a specific address |
| `GET` | `/api/stats` | Public stats (balance, fused QSR, tiers) |
| `GET` | `/api/health` | Bot health status |
| `POST` | `/api/admin/receive` | Force receive pending transactions (requires `X-Admin-Key`) |
| `POST` | `/api/admin/cycle` | Force balance monitor cycle (requires `X-Admin-Key`) |

## Deployment

The project deploys automatically via GitHub Actions when you push to `main`.

### Quick Start

1. Provision a DigitalOcean droplet (Ubuntu 22.04+, 1GB RAM)
2. Point your domain's DNS A record to the droplet IP
3. Run `scripts/vps-setup.sh` as root on the droplet
4. Transfer your encrypted wallet keyfile to `/etc/plasma-bot/wallet.json`
5. Update the `Caddyfile` with your domain
6. Add GitHub Secrets (see below)
7. Push to `main` to trigger the first deploy

### GitHub Secrets

Configure these in your repo under Settings > Secrets > Actions:

| Secret | Value |
|--------|-------|
| `VPS_HOST` | Droplet IP address |
| `VPS_SSH_KEY` | SSH private key for deploy user |
| `KEYFILE_PASSWORD` | Wallet decryption password |
| `ADMIN_API_KEY` | Admin endpoint key |
| `MONGODB_URI` | `mongodb://mongodb:27017/plasma-bot` |
| `ZNN_NODE_URL` | `wss://node.zenonhub.io:35998` |
| `FRONTEND_URL` | `https://yourdomain.com` |

### CI/CD Pipeline

On every push to `main`:
1. GitHub Actions runs backend tests and frontend lint
2. If tests pass, SSHs into the VPS
3. Pulls latest code, writes `.env.production` from secrets
4. Builds Docker images, extracts frontend assets
5. Restarts services and runs a health check

## Security

- Wallet keyfile encrypted with Argon2id + AES-256-GCM (via Zenon SDK)
- Keyfile password cleared from process memory after boot
- Non-root Docker user
- MongoDB not exposed to host network
- SSH key-only authentication, root login disabled
- UFW firewall: only ports 22, 80, 443
- Helmet security headers + Caddy HSTS
- Input validation via Zod
- Sensitive data redacted from logs

## License

[MIT](LICENSE)
