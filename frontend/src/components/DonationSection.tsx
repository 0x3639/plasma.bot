import { useState } from 'react';
import { useStats } from '../hooks/useFusions';
import { useDonations } from '../hooks/useDonations';
import { AddressRow } from './AddressRow';

function truncateAddress(addr: string, startChars: number, endChars: number): string {
  if (addr.length <= startChars + endChars + 3) return addr;
  return `${addr.slice(0, startChars)}...${addr.slice(-endChars)}`;
}

export function DonationSection() {
  const { data: stats } = useStats();
  const { data: donations, isLoading, isError } = useDonations();
  const [expanded, setExpanded] = useState(false);

  const donorList = donations?.donations ?? [];
  const donorCount = donations?.donorCount ?? 0;

  return (
    <div>
      <AddressRow address={stats?.walletAddress} />

      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="block cursor-pointer pt-2.5 text-[11px] text-dim hover:text-ink"
      >
        {expanded ? '[-] HIDE_DONATIONS' : `[+] SHOW_DONATIONS${donorCount > 0 ? ` (${donorCount})` : ''}`}
      </button>

      {expanded && (
        <div className="mt-2 border border-dim">
          {isLoading ? (
            <p className="px-3 py-[9px] text-[12px] text-dim">LOADING...</p>
          ) : isError && !donations ? (
            <p className="px-3 py-[9px] text-[12px] text-dim">ERR: could not load donations</p>
          ) : donorList.length === 0 ? (
            <p className="px-3 py-[9px] text-[12px] text-dim">NO DONATIONS YET</p>
          ) : (
            donorList.map((donor) => (
              <div
                key={donor.address}
                className="flex items-center justify-between gap-3 border-b border-faint-border px-3 py-[9px] last:border-b-0"
              >
                <a
                  href={`https://zenonhub.io/explorer/account/${donor.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-[12px] text-ink hover:underline"
                >
                  {truncateAddress(donor.address, 8, 5)}
                </a>
                <span className="shrink-0 text-[12px] text-ink">
                  {donor.totalQsr.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                  <span className="text-dim">QSR</span>
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
