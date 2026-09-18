export function TelegramCard() {
  return (
    <div>
      <p className="mb-3 text-[12px] leading-[1.6] text-dim">
        fuse directly from telegram. send a command with amount + address:
      </p>
      <div className="mb-3.5 border border-dashed border-ink px-3.5 py-3">
        <code className="text-[13px] text-ink">/fuse 120 z1youraddress...</code>
      </div>
      <div className="flex flex-wrap items-center gap-3.5">
        <a
          href="https://t.me/plazmade_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block border border-ink px-4 py-2 text-[12px] font-bold text-ink hover:bg-ink hover:text-black"
        >
          @PLAZMADE_BOT &#8599;
        </a>
        <span className="text-[11px] text-dim">tiers: 20 / 80 / 120 QSR</span>
      </div>
    </div>
  );
}
