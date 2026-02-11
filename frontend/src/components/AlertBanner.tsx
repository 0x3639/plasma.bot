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
      className={`mb-6 rounded-xl border p-4 ${
        type === 'success'
          ? 'bg-green-badge border-green-primary/30 text-green-primary'
          : 'bg-error/10 border-error/30 text-error'
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium">{message}</p>
          {txHash && (
            <p className="font-mono text-xs mt-1 opacity-80 break-all">
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
            className="text-current opacity-60 hover:opacity-100 ml-4 text-lg leading-none cursor-pointer"
          >
            &times;
          </button>
        )}
      </div>
    </div>
  );
}
