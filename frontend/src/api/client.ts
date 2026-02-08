const API_BASE = import.meta.env.VITE_API_URL || '';

export interface FuseResponse {
  success: boolean;
  txHash?: string;
  tier?: string;
  amount?: number;
  error?: string;
}

export interface FusionEntry {
  beneficiary: string;
  tier: 'low' | 'medium' | 'high';
  qsrAmount: number;
  fusedAt: string;
  status: string;
  fusionId?: string;
  txHash?: string;
  unfusedAt?: string;
}

export interface FusionsResponse {
  fusions: FusionEntry[];
  count: number;
  total: number;
  page: number;
  totalPages: number;
  address?: string;
}

export interface StatsResponse {
  walletAddress: string;
  qsrAvailable: number;
  qsrFused: number;
  qsrBalance: number;
  activeFusionCount: number;
  availableTiers: string[];
  nextUnfuseAt: string | null;
}

export async function requestFuse(data: {
  address: string;
  tier: 'low' | 'medium' | 'high';
}): Promise<FuseResponse> {
  const res = await fetch(`${API_BASE}/api/fuse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function getFusions(page = 1, limit = 20): Promise<FusionsResponse> {
  const res = await fetch(`${API_BASE}/api/fusions?page=${page}&limit=${limit}`);
  return res.json();
}

export async function getFusionsByAddress(address: string): Promise<FusionsResponse> {
  const res = await fetch(`${API_BASE}/api/fusions/${encodeURIComponent(address)}`);
  return res.json();
}

export async function getStats(): Promise<StatsResponse> {
  const res = await fetch(`${API_BASE}/api/stats`);
  return res.json();
}
