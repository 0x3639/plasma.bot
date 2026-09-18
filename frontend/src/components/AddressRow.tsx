import { useState } from 'react';

interface AddressRowProps {
  address?: string;
}

/** Bordered address row with explorer link and COPY button (bot wallet / donations). */
export function AddressRow({ address }: AddressRowProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    setTimeout(() => setCopyState('idle'), 2000);
  };

  const copyLabel = copyState === 'copied' ? 'COPIED' : copyState === 'failed' ? 'ERR' : 'COPY';

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
        className={`shrink-0 cursor-pointer border px-2.5 py-[3px] text-[11px] ${
          copyState === 'failed' ? 'border-error text-error' : 'border-dim text-dim hover:border-ink hover:text-ink'
        }`}
        title={copyState === 'failed' ? 'Copy failed' : 'Copy address'}
        aria-label="Copy address"
      >
        {copyLabel}
      </button>
    </div>
  );
}
