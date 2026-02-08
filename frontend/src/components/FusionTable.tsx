import { useState } from 'react';
import { useFusions } from '../hooks/useFusions';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
}

const TIER_COLORS: Record<string, string> = {
  low: 'text-text-secondary',
  medium: 'text-green-dim',
  high: 'text-green-primary',
};

const PAGE_SIZE = 20;

export function FusionTable() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useFusions(page, PAGE_SIZE);

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
              <th className="text-left text-text-secondary text-xs uppercase tracking-wider px-5 py-3 font-medium">
                Address
              </th>
              <th className="text-right text-text-secondary text-xs uppercase tracking-wider px-5 py-3 font-medium">
                Amount
              </th>
              <th className="text-center text-text-secondary text-xs uppercase tracking-wider px-5 py-3 font-medium">
                Tier
              </th>
              <th className="text-right text-text-secondary text-xs uppercase tracking-wider px-5 py-3 font-medium">
                Fused
              </th>
            </tr>
          </thead>
          <tbody>
            {fusions.map((fusion, i) => (
              <tr
                key={`${fusion.beneficiary}-${i}`}
                className="border-b border-border/50 last:border-0 hover:bg-bg-card-hover transition-colors"
              >
                <td className="px-5 py-3 font-mono text-text-primary text-xs">
                  <a
                    href={`https://zenonhub.io/explorer/account/${fusion.beneficiary}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-green-primary hover:underline transition-colors"
                  >
                    {truncateAddress(fusion.beneficiary)}
                  </a>
                </td>
                <td className="px-5 py-3 font-mono text-right text-text-primary">
                  {fusion.qsrAmount}
                  <span className="text-text-muted ml-1">QSR</span>
                </td>
                <td className="px-5 py-3 text-center">
                  <span className={`text-xs uppercase font-medium ${TIER_COLORS[fusion.tier] || ''}`}>
                    {fusion.tier}
                  </span>
                </td>
                <td className="px-5 py-3 text-right text-text-secondary text-xs">
                  {timeAgo(fusion.fusedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <p className="text-text-muted text-xs">
            {total} total fusion{total !== 1 ? 's' : ''}
          </p>
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
        </div>
      )}
    </div>
  );
}
