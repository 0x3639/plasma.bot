import { useStats } from '../hooks/useFusions';
import { AddressRow } from './AddressRow';

/** Unformatted number (no locale separators), at most 2 decimals. */
function plain(n: number | undefined, loading: boolean, failed: boolean): string {
  if (failed) return 'ERR';
  if (loading || n == null) return '...';
  return String(parseFloat(n.toFixed(2)));
}

function StatCell({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`min-w-0 p-3 sm:p-4 ${className}`}>
      <p className="mb-1.5 truncate text-[11px] text-dim">{label}</p>
      <p className="truncate text-[18px] font-bold text-ink sm:text-[24px]">{value}</p>
    </div>
  );
}

export function StatsBar() {
  const { data, isLoading, isError } = useStats();

  return (
    <div className="mb-9">
      <p className="mb-1.5 text-[11px] text-dim">BOT_WALLET:</p>
      <div className="mb-6">
        <AddressRow address={data?.walletAddress} />
      </div>

      {/* 2 + 1 on phones (block height spans the row), 3-up from sm */}
      <div className="grid grid-cols-2 border border-ink sm:grid-cols-3">
        <StatCell
          label="QSR_AVAILABLE"
          value={plain(data?.qsrAvailable, isLoading, isError)}
          className="border-r border-b border-ink sm:border-b-0"
        />
        <StatCell
          label="QSR_FUSED"
          value={plain(data?.qsrFused, isLoading, isError)}
          className="border-b border-ink sm:border-r sm:border-b-0"
        />
        <StatCell
          label="BLOCK_HEIGHT"
          value={plain(data?.currentHeight, isLoading, isError)}
          className="col-span-2 sm:col-span-1"
        />
      </div>
    </div>
  );
}
