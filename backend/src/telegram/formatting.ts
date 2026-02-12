import { CONFIG } from '../config/index.js';

const ZENONHUB_BASE = 'https://zenonhub.io/explorer/account';

function addressLink(address: string): string {
  return `<a href="${ZENONHUB_BASE}/${address}">${address.slice(0, 8)}...${address.slice(-6)}</a>`;
}

export function formatHelp(): string {
  return [
    '<b>Plasma Bot — Zenon Network</b>',
    '',
    'Fuse QSR to generate plasma for your address.',
    '',
    '<b>Commands:</b>',
    '<code>/fuse 20 z1...</code> — Low tier (20 QSR)',
    '<code>/fuse 80 z1...</code> — Medium tier (80 QSR)',
    '<code>/fuse 120 z1...</code> — High tier (120 QSR)',
    '<code>/fuse health</code> — Bot status',
    '<code>/fuse status</code> — Active fusions',
    '<code>/fuse status z1...</code> — Fusions for address',
  ].join('\n');
}

export function formatFuseSuccess(
  address: string,
  tier: string,
  amount: number,
  txHash: string,
): string {
  return [
    '<b>Plasma Fused</b>',
    '',
    `Address: ${addressLink(address)}`,
    `Amount: <b>${amount} QSR</b> (${tier})`,
    `TX: <code>${txHash}</code>`,
  ].join('\n');
}

export function formatHealth(data: {
  uptime: number;
  walletAddress: string;
  qsrBalance: number;
  activeFusionCount: number;
}): string {
  const hours = Math.floor(data.uptime / 3600);
  const mins = Math.floor((data.uptime % 3600) / 60);

  return [
    '<b>Plasma Bot Status</b>',
    '',
    `Status: <b>Online</b>`,
    `Uptime: ${hours}h ${mins}m`,
    `Wallet: ${addressLink(data.walletAddress)}`,
    `Balance: <b>${data.qsrBalance} QSR</b>`,
    `Active fusions: <b>${data.activeFusionCount}</b>`,
  ].join('\n');
}

export interface FusionListItem {
  beneficiary: string;
  tier: string;
  qsrAmount: number;
  fusedAt: Date;
}

export function formatFusionList(
  fusions: FusionListItem[],
  total: number,
  filterAddress?: string,
): string {
  if (fusions.length === 0) {
    return filterAddress
      ? `No active fusions for ${addressLink(filterAddress)}.`
      : 'No active fusions.';
  }

  const header = filterAddress
    ? `<b>Fusions for ${addressLink(filterAddress)}</b>`
    : `<b>Active Fusions</b> (${total} total)`;

  const lines = fusions.map((f) => {
    const qsr = f.qsrAmount / Math.pow(10, CONFIG.QSR_DECIMALS);
    const ago = timeAgo(f.fusedAt);
    return `${addressLink(f.beneficiary)} — ${qsr} QSR (${f.tier}) — ${ago}`;
  });

  const parts = [header, '', ...lines];

  if (fusions.length < total) {
    parts.push('', `<i>...and ${total - fusions.length} more</i>`);
  }

  return parts.join('\n');
}

export function formatError(message: string): string {
  return `<b>Error:</b> ${message}`;
}

export function formatRateLimited(remaining: number, maxPerDay: number): string {
  return `<b>Rate limited:</b> You've used your ${maxPerDay} fuse requests for today. Resets in 24h.`;
}

function timeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) return `${hours}h ${mins}m ago`;
  return `${mins}m ago`;
}
