interface AlertBannerProps {
  type: 'success' | 'error';
  message: string;
  txHash?: string;
  onDismiss?: () => void;
}

export function AlertBanner({ type, message, txHash, onDismiss }: AlertBannerProps) {
  return (
    <div
      role="alert"
      className={`mt-3.5 flex justify-between gap-3 border px-3.5 py-3 text-[12px] ${
        type === 'success' ? 'border-ink bg-faint text-ink' : 'border-error bg-error/10 text-error'
      }`}
    >
      <div className="min-w-0">
        <p>{message}</p>
        {txHash && (
          <p className="mt-1 break-all text-[11px] opacity-80">
            TX:{' '}
            <a
              href={`https://zenonhub.io/explorer/transaction/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:opacity-100"
            >
              {txHash}
            </a>
          </p>
        )}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 cursor-pointer self-start text-[12px] text-dim hover:text-ink"
        >
          [x]
        </button>
      )}
    </div>
  );
}
