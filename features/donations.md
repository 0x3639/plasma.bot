# Donation Address & Donor List

## Overview

Display a donation section at the bottom of the page showing the bot's wallet address as a donation target, with a collapsible list of addresses that have donated QSR.

## How It Works

### Backend (`/api/donations`)

Queries the Zenon node for the bot's account block history using `zenon.ledger.getAccountBlocksByPage()`. Filters for incoming QSR receive blocks, excluding returns from the embedded plasma contract (unfuse operations). Aggregates donations by sender address and returns sorted by total QSR donated.

Results are cached in memory for 5 minutes to avoid excessive node queries.

### Frontend (`DonationSection` component)

- **Donation address card**: Full bot wallet address (untruncated), copyable, links to ZenonHub
- **Collapsible donor list**: Toggle with "Show Donations (N)" button
  - Each row: clickable donor address + total QSR donated
  - Sorted by amount (highest first)
  - Polls every 60 seconds

## API Response

```json
GET /api/donations

{
  "donations": [
    { "address": "z1q...", "totalQsr": 500.0, "count": 3 }
  ],
  "totalDonated": 1500.0,
  "donorCount": 5
}
```

## Files

| File | Description |
|------|-------------|
| `backend/src/routes/donations.ts` | API endpoint |
| `frontend/src/components/DonationSection.tsx` | UI component |
| `frontend/src/hooks/useDonations.ts` | React Query hook |
