# Plasma Bot — Frontend

Single-page React app for the [Zenon Network Plasma Bot](https://plasmabot.zenon.info). Users request temporary plasma by selecting a tier and entering their Zenon address.

## Tech Stack

- **React 19** + TypeScript
- **Vite** (build tooling)
- **Tailwind CSS v4** (`@theme` directive for custom design tokens)
- **TanStack React Query** (data fetching with 10s/60s auto-polling)

## Development

```bash
# From project root — install all workspace dependencies
npm install

# Start dev server (port 5173, proxies /api to backend at :3001)
npm run dev --workspace=frontend

# Production build
npm run build --workspace=frontend

# Lint
npm run lint --workspace=frontend
```

The dev server proxies `/api/*` requests to `http://localhost:3001`, so start the backend first.

## Design

SYRIUS-inspired dark theme with neon green accents. All design tokens are defined in `src/index.css`:

| Token | Value | Purpose |
|-------|-------|---------|
| `--color-bg-primary` | `#0a0a14` | Page background |
| `--color-bg-card` | `#14142a` | Card/panel background |
| `--color-green-primary` | `#00ff41` | Primary accent |
| `--color-text-primary` | `#e8e8e8` | Body text |
| `--color-text-muted` | `#8686a0` | Secondary/muted text (WCAG AA compliant) |

## Performance Optimizations

- **Inlined CSS** — A custom Vite plugin (`vite.config.ts`) inlines all CSS into `index.html` at build time, eliminating render-blocking stylesheet requests.
- **Non-blocking fonts** — Google Fonts loaded via `preload`/`onload` swap pattern; fonts never block first paint.
- **API prefetch** — An inline `<script>` in `index.html` starts fetching `/api/stats`, `/api/fusions`, and `/api/donations` immediately, in parallel with the JS bundle download. The API client consumes these prefetched responses on first load.
- **Compression** — Caddy serves with zstd/gzip encoding. Hashed Vite assets get immutable cache headers.

## Project Structure

```
src/
  api/client.ts        # API client with prefetch support
  components/
    AddressInput.tsx    # Zenon address input with validation
    AlertBanner.tsx     # Success/error notification banner
    DonationSection.tsx # Donation address + donor leaderboard
    FusionTable.tsx     # Active fusions table with pagination
    StatsBar.tsx        # Wallet address + QSR balance cards
    TierSelector.tsx    # Plasma tier selection (20/80/120 QSR)
  hooks/
    useDonations.ts     # React Query hook for donations
    useFuseRequest.ts   # Mutation hook for fuse requests
    useFusions.ts       # React Query hooks for fusions + stats
  pages/
    Home.tsx            # Main (and only) page
  index.css             # Tailwind theme + global styles
  main.tsx              # App entry point + QueryClient setup
```

## PageSpeed Scores

| Category | Mobile | Desktop |
|----------|--------|---------|
| Performance | 91 | 100 |
| Accessibility | 100 | 100 |
| SEO | 100 | 100 |
