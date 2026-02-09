import { useState } from 'react';
import { useFusions, useStats } from '../hooks/useFusions';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function truncateAddress(addr: string, startChars: number, endChars: number): string {
  if (addr.length <= startChars + endChars + 3) return addr;
  return `${addr.slice(0, startChars)}...${addr.slice(-endChars)}`;
}

const TIER_COLORS: Record<string, string> = {
  low: 'text-text-secondary',
  medium: 'text-green-dim',
  high: 'text-green-primary',
};

const PAGE_SIZE_OPTIONS = [10, 25, 100] as const;

export function FusionTable() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const { data, isLoading } = useFusions(page, pageSize);
  const { data: statsData } = useStats();
  const currentHeight = statsData?.currentHeight ?? 0;

  if (isLoading) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
        <p className="text-text-muted">Loading fusions...</p>
      </div>
    );
  }

  const fusions = data?.fusions || [];
  const totalPages = data?.totalPages || 1;
  const total = data?.total || 0;

  if (fusions.length === 0 && page === 1) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
        <p className="text-text-muted">No active fusions</p>
      </div>
    );
  }

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-text-secondary text-xs uppercase tracking-wider px-2 sm:px-4 py-3 font-medium">
                Address
              </th>
              <th className="text-right text-text-secondary text-xs uppercase tracking-wider px-2 sm:px-4 py-3 font-medium">
                Amount
              </th>
              <th className="text-center text-text-secondary text-xs uppercase tracking-wider px-2 sm:px-4 py-3 font-medium">
                Tier
              </th>
              <th className="hidden sm:table-cell text-right text-text-secondary text-xs uppercase tracking-wider px-2 sm:px-4 py-3 font-medium">
                Revocable
              </th>
              <th className="text-right text-text-secondary text-xs uppercase tracking-wider px-2 sm:px-4 py-3 font-medium">
                Fused
              </th>
            </tr>
          </thead>
          <tbody>
            {fusions.map((fusion, i) => (
              <tr
                key={fusion.txHash || `${fusion.beneficiary}-${i}`}
                className="border-b border-border/50 last:border-0 hover:bg-bg-card-hover transition-colors"
              >
                <td className="px-2 sm:px-4 py-3 font-mono text-text-primary text-xs">
                  <a
                    href={`https://zenonhub.io/explorer/account/${fusion.beneficiary}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-green-primary hover:underline transition-colors"
                  >
                    <span className="sm:hidden">{truncateAddress(fusion.beneficiary, 3, 5)}</span>
                    <span className="hidden sm:inline">{truncateAddress(fusion.beneficiary, 6, 6)}</span>
                  </a>
                </td>
                <td className="px-2 sm:px-4 py-3 font-mono text-right text-text-primary">
                  {fusion.qsrAmount}
                  <span className="text-text-muted ml-1">QSR</span>
                </td>
                <td className="px-2 sm:px-4 py-3 text-center">
                  <span className={`text-xs uppercase font-medium ${TIER_COLORS[fusion.tier] || ''}`}>
                    {fusion.tier}
                  </span>
                </td>
                <td className="hidden sm:table-cell px-2 sm:px-4 py-3 font-mono text-right text-xs whitespace-nowrap">
                  {fusion.expirationHeight != null ? (
                    <span className={fusion.expirationHeight <= currentHeight ? 'text-green-primary' : 'text-error'}>
                      {fusion.expirationHeight.toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="px-2 sm:px-4 py-3 text-right text-text-secondary text-xs whitespace-nowrap">
                  {timeAgo(fusion.fusedAt)}<span className="hidden sm:inline"> ago</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 sm:px-4 py-3 border-t border-border">
        <div className="flex items-center gap-3">
          <p className="text-text-muted text-xs">
            {total} total fusion{total !== 1 ? 's' : ''}
          </p>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="bg-bg-card border border-border rounded px-2 py-1 text-xs text-text-secondary cursor-pointer focus:outline-none focus:border-green-primary transition-colors"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 text-xs rounded border border-border text-text-secondary hover:bg-bg-card-hover disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              Prev
            </button>
            <span className="text-text-muted text-xs">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 text-xs rounded border border-border text-text-secondary hover:bg-bg-card-hover disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
