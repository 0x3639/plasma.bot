import { useState } from 'react';
import { StatsBar } from '../components/StatsBar';
import { AddressInput } from '../components/AddressInput';
import { TierSelector } from '../components/TierSelector';
import { FusionTable } from '../components/FusionTable';
import { AlertBanner } from '../components/AlertBanner';
import { DonationSection } from '../components/DonationSection';
import { TelegramCard } from '../components/TelegramCard';
import { useFuseRequest } from '../hooks/useFuseRequest';
import { useStats } from '../hooks/useFusions';

type Tier = 'low' | 'medium' | 'high';

function formatTimeUntil(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return 'soon';
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `~${hours}h ${minutes}m`;
  return `~${minutes}m`;
}

export function Home() {
  const [address, setAddress] = useState('');
  const [tier, setTier] = useState<Tier | null>(null);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string; txHash?: string } | null>(null);

  const fuseMutation = useFuseRequest();
  const { data: stats } = useStats();

  const availableTiers = stats?.availableTiers;
  const noTiersAvailable = availableTiers && availableTiers.length === 0;

  // Derive effective tier: clear selection if it became unavailable
  const effectiveTier = tier && availableTiers && !availableTiers.includes(tier) ? null : tier;

  const isValidAddress = /^z1[a-z0-9]{38}$/.test(address);
  const canSubmit = isValidAddress && effectiveTier !== null && !fuseMutation.isPending && !noTiersAvailable;

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
          message: `Fused ${result.amount} QSR to ${address}`,
          txHash: result.txHash,
        });
        setAddress('');
        setTier(null);
      } else {
        setAlert({ type: 'error', message: result.error || 'Fuse request failed' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error. Please try again.';
      setAlert({ type: 'error', message });
    }
  };

  return (
    <main className="min-h-screen bg-bg-primary">
      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="text-green-primary text-2xl sm:text-3xl" aria-hidden="true">&#9889;</span>
            <h1 className="text-2xl sm:text-3xl font-bold text-text-primary">Plasma Bot</h1>
          </div>
          <p className="text-text-secondary text-sm max-w-md mx-auto">
            Fuse QSR to generate plasma for your Zenon address.
            Plasma enables feeless transactions on the Network of Momentum.
          </p>
        </div>

        {/* QSR Stats */}
        <StatsBar />

        {/* Alert */}
        {alert && (
          <AlertBanner
            type={alert.type}
            message={alert.message}
            txHash={alert.txHash}
            onDismiss={() => setAlert(null)}
          />
        )}

        {/* Fuse Form */}
        <div className="bg-bg-card border border-border rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-text-primary mb-5">Request Plasma</h2>

          {noTiersAvailable ? (
            <div className="text-center py-4">
              <p className="text-text-secondary text-sm mb-2">
                The bot is currently out of QSR.
              </p>
              {stats?.nextUnfuseAt ? (
                <p className="text-text-muted text-sm">
                  QSR will be reclaimed in {formatTimeUntil(stats.nextUnfuseAt)}. Please check back then.
                </p>
              ) : (
                <p className="text-text-muted text-sm">
                  Please check back later.
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <AddressInput value={address} onChange={setAddress} />
              <TierSelector selected={effectiveTier} onSelect={setTier} availableTiers={availableTiers} />
              <button
                type="submit"
                disabled={!canSubmit}
                className={`w-full py-3 rounded-lg font-semibold text-sm uppercase tracking-wider transition-all ${
                  canSubmit
                    ? 'bg-green-primary text-bg-primary hover:bg-green-dim cursor-pointer shadow-[0_0_20px_var(--color-green-glow)]'
                    : 'bg-border text-text-muted cursor-not-allowed'
                }`}
              >
                {fuseMutation.isPending ? 'Fusing...' : 'Fuse Plasma'}
              </button>
            </form>
          )}
        </div>

        {/* Active Fusions Table */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Active Fusions</h2>
          <FusionTable />
        </div>

        {/* Telegram Bot */}
        <div className="mb-8">
          <TelegramCard />
        </div>

        {/* Footer / FAQ */}
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h3 className="text-base font-semibold text-text-primary mb-3">
            What is Plasma?
          </h3>
          <p className="text-text-secondary text-sm leading-relaxed mb-4">
            Plasma is the anti-spam mechanism on the Zenon Network that enables feeless transactions.
            It is generated by fusing QSR tokens to an address. The more QSR fused, the higher the
            transaction throughput. QSR can be unfused at any time with no loss.
          </p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-bg-primary rounded-lg p-3">
              <p className="font-mono text-lg text-green-primary font-bold">20</p>
              <p className="text-text-muted text-xs">Low QSR</p>
            </div>
            <div className="bg-bg-primary rounded-lg p-3">
              <p className="font-mono text-lg text-green-dim font-bold">80</p>
              <p className="text-text-muted text-xs">Medium QSR</p>
            </div>
            <div className="bg-bg-primary rounded-lg p-3">
              <p className="font-mono text-lg text-green-primary font-bold">120</p>
              <p className="text-text-muted text-xs">High QSR</p>
            </div>
          </div>
        </div>

        {/* Donations */}
        <DonationSection />

        <p className="text-center text-text-muted text-xs mt-8">
          Powered by the Network of Momentum
        </p>
      </div>
    </main>
  );
}
