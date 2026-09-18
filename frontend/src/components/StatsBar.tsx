import { useStats } from '../hooks/useFusions';
import { AddressRow } from './AddressRow';

/** Unformatted number (no locale separators), at most 2 decimals. */
function plain(n: number | undefined, loading: boolean, failed: boolean): string {
  if (failed) return 'ERR';
  if (loading || n == null) return '...';
  return String(parseFloat(n.toFixed(2)));
}

function StatCell({ label, value, divider }: { label: string; value: string; divider?: boolean }) {
  return (
    <div className={`p-3 sm:p-4 ${divider ? 'border-r border-ink' : ''}`}>
      <p className="mb-1.5 text-[11px] text-dim">{label}</p>
      <p className="text-[18px] font-bold text-ink sm:text-[24px]">{value}</p>
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

      <div className="grid grid-cols-3 border border-ink">
        <StatCell label="QSR_AVAILABLE" value={plain(data?.qsrAvailable, isLoading, isError)} divider />
        <StatCell label="QSR_FUSED" value={plain(data?.qsrFused, isLoading, isError)} divider />
        <StatCell label="BLOCK_HEIGHT" value={plain(data?.currentHeight, isLoading, isError)} />
      </div>
    </div>
  );
}
