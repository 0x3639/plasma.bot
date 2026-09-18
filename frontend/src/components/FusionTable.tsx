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

const TIER_LABELS: Record<string, string> = { low: 'LOW', medium: 'MED', high: 'HIGH' };

const PAGE_SIZE_OPTIONS = [10, 25, 100] as const;

const TH = 'px-3 py-2 font-normal text-dim';
const TD = 'px-3 py-2';
const PAGER_BTN =
  'cursor-pointer border border-dim px-3 py-1 text-[11px] text-dim hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-dim disabled:hover:text-dim';

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-ink p-6 text-center">
      <p className="text-[12px] text-dim">{children}</p>
    </div>
  );
}

export function FusionTable() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const { data, isLoading } = useFusions(page, pageSize);
  const { data: statsData } = useStats();
  const currentHeight = statsData?.currentHeight ?? 0;

  if (isLoading) return <Notice>LOADING...</Notice>;

  const fusions = data?.fusions || [];
  const totalPages = data?.totalPages || 1;
  const total = data?.total || 0;

  if (fusions.length === 0 && page === 1) return <Notice>NO ACTIVE FUSIONS</Notice>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-ink text-[12px]">
          <caption className="sr-only">Active plasma fusions</caption>
          <thead>
            <tr className="border-b border-ink">
              <th className={`${TH} text-left`}>ADDR</th>
              <th className={`${TH} text-right`}>QSR</th>
              <th className={`${TH} text-right`}>TIER</th>
              <th className={`${TH} hidden text-right sm:table-cell`}>REVOCABLE</th>
              <th className={`${TH} text-right`}>T-AGO</th>
            </tr>
          </thead>
          <tbody>
            {fusions.map((fusion, i) => (
              <tr
                key={fusion.txHash || `${fusion.beneficiary}-${i}`}
                className="border-b border-faint-border last:border-b-0 hover:bg-faint"
              >
                <td className={TD}>
                  <a
                    href={`https://zenonhub.io/explorer/account/${fusion.beneficiary}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink hover:underline"
                  >
                    {truncateAddress(fusion.beneficiary, 8, 5)}
                  </a>
                </td>
                <td className={`${TD} text-right font-bold text-ink`}>{fusion.qsrAmount}</td>
                <td className={`${TD} text-right ${fusion.tier === 'high' ? 'text-ink' : 'text-dim'}`}>
                  {TIER_LABELS[fusion.tier] || fusion.tier.toUpperCase()}
                </td>
                <td className={`${TD} hidden whitespace-nowrap text-right sm:table-cell`}>
                  {fusion.expirationHeight != null ? (
                    <span className={fusion.expirationHeight <= currentHeight ? 'text-ink' : 'text-error'}>
                      {fusion.expirationHeight.toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>
                <td className={`${TD} whitespace-nowrap text-right text-dim`}>{timeAgo(fusion.fusedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-dim">
            {total} TOTAL · PAGE {page}/{totalPages}
          </span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            aria-label="Fusions per page"
            className="cursor-pointer border border-dim bg-black px-2 py-1 text-[11px] text-dim outline-none focus:border-ink"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} / PAGE
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className={PAGER_BTN}>
            &lt; PREV
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className={PAGER_BTN}
          >
            NEXT &gt;
          </button>
        </div>
      </div>
    </div>
  );
}
