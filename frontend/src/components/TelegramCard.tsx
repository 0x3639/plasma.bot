export function TelegramCard() {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-6">
      <h3 className="text-base font-semibold text-text-primary mb-3">Fuse via Telegram</h3>
      <p className="text-text-secondary text-sm leading-relaxed mb-4">
        You can also fuse plasma by messaging our Telegram bot directly. Send a command with your
        desired QSR amount and address:
      </p>
      <div className="bg-bg-primary rounded-lg p-3 mb-4">
        <code className="text-green-primary text-sm">/fuse 120 z1youraddress...</code>
      </div>
      <div className="flex items-center gap-3">
        <a
          href="https://t.me/plazmade_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2AABEE] hover:bg-[#229ED9] text-white text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
          </svg>
          @plazmade_bot
        </a>
        <span className="text-text-muted text-xs">
          Available tiers: 20, 80, 120 QSR
        </span>
      </div>
    </div>
  );
}
