import { useState } from 'react';
import { StatsBar } from '../components/StatsBar';
import { AddressInput } from '../components/AddressInput';
import { TierSelector } from '../components/TierSelector';
import { FusionTable } from '../components/FusionTable';
import { AlertBanner } from '../components/AlertBanner';
import { DonationSection } from '../components/DonationSection';
import { TelegramCard } from '../components/TelegramCard';
import { SectionHeader } from '../components/SectionHeader';
import { useFuseRequest } from '../hooks/useFuseRequest';
import { useStats } from '../hooks/useFusions';

type Tier = 'low' | 'medium' | 'high';

const TIER_QSR: Record<Tier, number> = { low: 20, medium: 80, high: 120 };

/** CRT scanline overlay; disable with VITE_SCANLINES=false. */
const SCANLINES = import.meta.env.VITE_SCANLINES !== 'false';

function formatTimeUntil(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return 'soon';
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `~${hours}h ${minutes}m`;
  return `~${minutes}m`;
}

function truncateAddress(addr: string): string {
  return addr.length > 8 ? `${addr.slice(0, 8)}...` : addr;
}

function FaqTier({ qsr, label, divider }: { qsr: number; label: string; divider?: boolean }) {
  return (
    <div className={`p-3 ${divider ? 'border-r border-dim' : ''}`}>
      <p className="text-[18px] font-bold text-ink">{qsr}</p>
      <p className="text-[11px] text-dim">{label}</p>
    </div>
  );
}

export function Home() {
  const [address, setAddress] = useState('');
  const [tier, setTier] = useState<Tier | null>(null);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string; txHash?: string } | null>(null);

  const fuseMutation = useFuseRequest();
  const { data: stats, isError: statsError } = useStats();

  const availableTiers = stats?.availableTiers;
  const noTiersAvailable = availableTiers && availableTiers.length === 0;

  // Derive effective tier: clear selection if it became unavailable
  const effectiveTier = tier && availableTiers && !availableTiers.includes(tier) ? null : tier;

  const isValidAddress = /^z1[a-z0-9]{38}$/.test(address);
  const canSubmit = isValidAddress && effectiveTier !== null && !fuseMutation.isPending && !noTiersAvailable;

  const submitLabel = fuseMutation.isPending
    ? '>> EXECUTING...'
    : canSubmit && effectiveTier
      ? `>> EXECUTE FUSE (${TIER_QSR[effectiveTier]} QSR)`
      : '>> EXECUTE FUSE';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !effectiveTier) return;

    setAlert(null);

    try {
      const result = await fuseMutation.mutateAsync({
        address,
        tier: effectiveTier,
      });

      if (result.success) {
        setAlert({
          type: 'success',
          message: `OK: fused ${result.amount} QSR to ${truncateAddress(address)}`,
          txHash: result.txHash,
        });
        setAddress('');
        setTier(null);
      } else {
        setAlert({ type: 'error', message: `ERR: ${result.error || 'fuse request failed'}` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error. please try again.';
      setAlert({ type: 'error', message: `ERR: ${message}` });
    }
  };

  return (
    <>
      {SCANLINES && <div className="scanlines" aria-hidden="true" />}
      <main className="relative min-h-screen bg-bg">
        <div className="mx-auto max-w-[760px] px-4 pt-8 pb-16">
          <div className="border-2 border-ink">
            {/* Title bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-ink px-5 py-2.5">
              <h1 className="text-[13px] font-bold text-ink">PLAZMA.BOT // QSR FUSION TERMINAL</h1>
              <span className="text-[12px] text-dim">
                v2.1 · <span className="text-ink">{statsError ? 'OFFLINE' : 'ONLINE'}</span>
              </span>
            </div>

            <div className="px-4 pt-7 pb-10 sm:px-7">
              {/* Intro */}
              <pre className="mb-7 whitespace-pre-wrap text-[12px] leading-[1.5] text-ink">
{`> fuse QSR --> plasma --> feeless tx
> network: zenon / network of momentum
> rate limit: 4 req / ip / 24h · 1 active fusion per address`}
              </pre>

              <StatsBar />

              {/* Request form */}
              <SectionHeader className="mb-4">[ REQUEST_PLASMA ]</SectionHeader>

              {noTiersAvailable ? (
                <p className="text-[12px] text-dim">
                  ERR: bot out of QSR —{' '}
                  {stats?.nextUnfuseAt ? `reclaim in ${formatTimeUntil(stats.nextUnfuseAt)}` : 'check back later'}
                </p>
              ) : (
                <form onSubmit={handleSubmit}>
                  <AddressInput value={address} onChange={setAddress} />
                  <TierSelector selected={effectiveTier} onSelect={setTier} availableTiers={availableTiers} />
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className={`w-full border border-ink p-3.5 text-[14px] font-bold uppercase tracking-[0.1em] ${
                      canSubmit ? 'cursor-pointer bg-ink text-black' : 'cursor-not-allowed bg-black text-dim'
                    }`}
                  >
                    {submitLabel}
                  </button>
                </form>
              )}

              {alert && (
                <AlertBanner
                  type={alert.type}
                  message={alert.message}
                  txHash={alert.txHash}
                  onDismiss={() => setAlert(null)}
                />
              )}

              {/* Active fusions */}
              <SectionHeader className="mt-11 mb-3">
                [ ACTIVE_FUSIONS{stats ? ` :: ${stats.activeFusionCount}` : ''} ]
              </SectionHeader>
              <FusionTable />

              {/* Telegram */}
              <SectionHeader className="mt-11 mb-3">[ TELEGRAM_UPLINK ]</SectionHeader>
              <TelegramCard />

              {/* FAQ */}
              <SectionHeader className="mt-11 mb-3">[ WHAT_IS_PLASMA ]</SectionHeader>
              <p className="mb-4 text-[12px] leading-[1.7] text-dim">
                plasma is the anti-spam mechanism on the zenon network that enables feeless transactions. it is
                generated by fusing QSR tokens to an address. the more QSR fused, the higher the transaction
                throughput. QSR can be unfused at any time with no loss.
              </p>
              <div className="grid grid-cols-3 border border-dim text-center">
                <FaqTier qsr={20} label="LOW" divider />
                <FaqTier qsr={80} label="MED" divider />
                <FaqTier qsr={120} label="HIGH" />
              </div>

              {/* Donations */}
              <SectionHeader className="mt-11 mb-3">[ DONATE ]</SectionHeader>
              <DonationSection />

              {/* Footer */}
              <p className="mt-11 text-[11px] text-dim">
                &gt; powered_by:{' '}
                <a
                  href="https://zenon.network"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-dim hover:text-ink"
                >
                  zenon.network
                </a>
                <span
                  className="cursor-blink ml-1.5 inline-block h-[13px] w-[7px] bg-ink align-text-bottom"
                  aria-hidden="true"
                />
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
