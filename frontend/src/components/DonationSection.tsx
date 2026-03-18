import { useState } from 'react';
import { useStats } from '../hooks/useFusions';
import { useDonations } from '../hooks/useDonations';

function truncateAddress(addr: string, startChars: number, endChars: number): string {
  if (addr.length <= startChars + endChars + 3) return addr;
  return `${addr.slice(0, startChars)}...${addr.slice(-endChars)}`;
}

export function DonationSection() {
  const { data: stats } = useStats();
  const { data: donations, isLoading } = useDonations();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const walletAddress = stats?.walletAddress;
  const donorList = donations?.donations ?? [];
  const donorCount = donations?.donorCount ?? 0;

  const copyAddress = async () => {
    if (!walletAddress) return;
    await navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-6 space-y-3">
      {/* Donation Address Card */}
      <div className="bg-bg-card border border-border rounded-xl p-4 sm:p-5">
        <p className="text-text-secondary text-xs uppercase tracking-wider mb-2">Donation Address</p>
        <div className="flex items-center gap-2">
          {walletAddress ? (
            <a
              href={`https://zenonhub.io/explorer/account/${walletAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs sm:text-sm text-green-primary flex-1 break-all hover:underline"
            >
              {walletAddress}
            </a>
          ) : (
            <p className="font-mono text-sm text-green-primary flex-1">...</p>
          )}
          <button
            onClick={copyAddress}
            className="text-text-muted hover:text-green-primary transition-colors text-xs shrink-0 cursor-pointer"
            title="Copy address"
            aria-label="Copy address"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Toggle Button */}
      <div className="text-center">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-text-secondary hover:text-green-primary text-xs transition-colors cursor-pointer px-3 py-1"
        >
          {expanded ? 'Hide Donations' : `Show Donations${donorCount > 0 ? ` (${donorCount})` : ''}`}
          <span className="ml-1">{expanded ? '\u25B2' : '\u25BC'}</span>
        </button>
      </div>

      {/* Collapsible Donor List */}
      {expanded && (
        <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
          {isLoading ? (
            <p className="text-text-muted text-sm text-center py-6">Loading donations...</p>
          ) : donorList.length === 0 ? (
            <p className="text-text-muted text-sm text-center py-6">No donations yet</p>
          ) : (
            <div className="divide-y divide-border/50">
              {donorList.map((donor) => (
                <div
                  key={donor.address}
                  className="flex items-center justify-between px-3 sm:px-4 py-3 hover:bg-bg-card-hover transition-colors"
                >
                  <a
                    href={`https://zenonhub.io/explorer/account/${donor.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-text-primary hover:text-green-primary hover:underline transition-colors"
                  >
                    <span className="sm:hidden">{truncateAddress(donor.address, 6, 6)}</span>
                    <span className="hidden sm:inline">{truncateAddress(donor.address, 8, 6)}</span>
                  </a>
                  <span className="font-mono text-xs text-text-primary ml-3">
                    {donor.totalQsr.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    <span className="text-text-muted ml-1">QSR</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
