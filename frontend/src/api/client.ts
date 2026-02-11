const API_BASE = import.meta.env.VITE_API_URL || '';

/** Consume a prefetched response (started in index.html), if available. */
function consumePrefetch(url: string): Promise<Response> | null {
  const store = (window as unknown as Record<string, unknown>).__prefetch as
    | Record<string, Promise<Response>>
    | undefined;
  if (store?.[url]) {
    const promise = store[url];
    delete store[url];
    return promise;
  }
  return null;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error || `Request failed (${res.status})`);
  }
  return res.json();
}

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
  expirationHeight?: number | null;
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
  currentHeight: number;
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
  return handleResponse<FuseResponse>(res);
}

export async function getFusions(page = 1, limit = 20): Promise<FusionsResponse> {
  const url = `/api/fusions?page=${page}&limit=${limit}`;
  const res = await (consumePrefetch(url) ?? fetch(`${API_BASE}${url}`));
  return handleResponse<FusionsResponse>(res);
}

export async function getFusionsByAddress(address: string): Promise<FusionsResponse> {
  const res = await fetch(`${API_BASE}/api/fusions/${encodeURIComponent(address)}`);
  return handleResponse<FusionsResponse>(res);
}

export async function getStats(): Promise<StatsResponse> {
  const url = '/api/stats';
  const res = await (consumePrefetch(url) ?? fetch(`${API_BASE}${url}`));
  return handleResponse<StatsResponse>(res);
}

export interface DonationEntry {
  address: string;
  totalQsr: number;
  count: number;
}

export interface DonationsResponse {
  donations: DonationEntry[];
  totalDonated: number;
  donorCount: number;
}

export async function getDonations(): Promise<DonationsResponse> {
  const url = '/api/donations';
  const res = await (consumePrefetch(url) ?? fetch(`${API_BASE}${url}`));
  return handleResponse<DonationsResponse>(res);
}
