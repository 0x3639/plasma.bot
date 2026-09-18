import { useState } from 'react';

interface AddressRowProps {
  address?: string;
}

/** Bordered address row with explorer link and COPY button (bot wallet / donations). */
export function AddressRow({ address }: AddressRowProps) {
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-3 border border-ink px-3 py-2.5">
      {address ? (
        <a
          href={`https://zenonhub.io/explorer/account/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate text-[12px] text-ink hover:underline"
        >
          {address}
        </a>
      ) : (
        <p className="flex-1 text-[12px] text-ink">...</p>
      )}
      <button
        onClick={copyAddress}
        className="shrink-0 cursor-pointer border border-dim px-2.5 py-[3px] text-[11px] text-dim hover:border-ink hover:text-ink"
        title="Copy address"
        aria-label="Copy address"
      >
        {copied ? 'COPIED' : 'COPY'}
      </button>
    </div>
  );
}
