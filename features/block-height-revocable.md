# Feature: Block Height & Revocable Column

## Overview

Display the current Zenon momentum height in the stats bar and show when each fusion becomes revocable in the Active Fusions table.

## Requirements

### Block Height (all screen sizes)
- Display current momentum height below the QSR Available / QSR Fused cards
- Full-width card with green glow styling matching existing stats
- Refreshes every 10 seconds (matching Zenon's momentum production rate)

### Revocable Column (desktop/iPad only)
- New column in the Active Fusions table showing the `expirationHeight` for each fusion
- **Green** (`text-green-primary`): fusion is revocable (`expirationHeight <= currentHeight`)
- **Red** (`text-error`): fusion is still locked (`expirationHeight > currentHeight`)
- Hidden on mobile (`< 640px`) to preserve table layout

## API Changes

- `GET /api/stats` — adds `currentHeight: number` (current momentum height)
- `GET /api/fusions` — adds `expirationHeight: number | null` to each fusion entry

## Files Modified

| File | Change |
|------|--------|
| `backend/src/routes/stats.ts` | Add `currentHeight` to response |
| `backend/src/routes/status.ts` | Expose `expirationHeight` in fusion entries |
| `frontend/src/api/client.ts` | Update TypeScript interfaces |
| `frontend/src/hooks/useFusions.ts` | Change polling from 30s to 10s |
| `frontend/src/components/StatsBar.tsx` | Add Block Height card |
| `frontend/src/components/FusionTable.tsx` | Add Revocable column |
