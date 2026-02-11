import { useState } from 'react';
import { useStats } from '../hooks/useFusions';

function truncateAddress(address: string, startChars = 10, endChars = 6): string {
  if (address.length <= startChars + endChars + 3) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

export function StatsBar() {
  const { data, isLoading } = useStats();
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (!data?.walletAddress) return;
    await navigator.clipboard.writeText(data.walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mb-8 space-y-4">
      {/* Wallet Address */}
      <div className="bg-bg-card border border-border rounded-xl p-4">
        <p className="text-text-secondary text-xs uppercase tracking-wider mb-2">Bot Wallet Address</p>
        <div className="flex items-center gap-2">
          {isLoading ? (
            <p className="font-mono text-sm text-green-primary truncate flex-1">...</p>
          ) : (
            <a
              href={`https://zenonhub.io/explorer/account/${data?.walletAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sm text-green-primary flex-1 hover:underline"
            >
              {data?.walletAddress ? truncateAddress(data.walletAddress) : ''}
            </a>
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

      {/* QSR Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1.4fr] gap-3 sm:gap-4">
        <div className="bg-bg-card border border-border rounded-xl p-4 sm:p-5 shadow-[0_0_20px_var(--color-green-glow),inset_0_1px_0_var(--color-border-accent)]">
          <p className="text-text-secondary text-xs sm:text-sm mb-1 uppercase tracking-wider">QSR Available</p>
          <p className="font-mono text-2xl sm:text-3xl font-bold text-green-primary">
            {isLoading ? '...' : data?.qsrAvailable.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-bg-card border border-border rounded-xl p-4 sm:p-5 shadow-[0_0_20px_var(--color-green-glow),inset_0_1px_0_var(--color-border-accent)]">
          <p className="text-text-secondary text-xs sm:text-sm mb-1 uppercase tracking-wider">QSR Fused</p>
          <p className="font-mono text-2xl sm:text-3xl font-bold text-green-primary">
            {isLoading ? '...' : data?.qsrFused.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="col-span-2 sm:col-span-1 bg-bg-card border border-border rounded-xl p-4 sm:p-5 shadow-[0_0_20px_var(--color-green-glow),inset_0_1px_0_var(--color-border-accent)]">
          <p className="text-text-secondary text-xs sm:text-sm mb-1 uppercase tracking-wider">Block Height</p>
          <p className="font-mono text-2xl sm:text-3xl font-bold text-green-primary">
            {isLoading ? '...' : data?.currentHeight.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
