type Tier = 'low' | 'medium' | 'high';

interface TierSelectorProps {
  selected: Tier | null;
  onSelect: (tier: Tier) => void;
  availableTiers?: string[];
}

const TIERS: { id: Tier; label: string; qsr: number; description: string }[] = [
  { id: 'low', label: 'Low', qsr: 20, description: 'Basic' },
  { id: 'medium', label: 'Medium', qsr: 80, description: 'Regular' },
  { id: 'high', label: 'High', qsr: 120, description: 'Full' },
];

export function TierSelector({ selected, onSelect, availableTiers }: TierSelectorProps) {
  return (
    <div className="mb-5">
      <label className="block text-text-secondary text-sm mb-2 uppercase tracking-wider">
        Plasma Tier
      </label>
      <div className="grid grid-cols-3 gap-3">
        {TIERS.map((tier) => {
          const isAvailable = !availableTiers || availableTiers.includes(tier.id);
          const isSelected = selected === tier.id;

          return (
            <button
              key={tier.id}
              type="button"
              onClick={() => isAvailable && onSelect(tier.id)}
              disabled={!isAvailable}
              className={`relative bg-bg-card border rounded-xl p-4 text-center transition-all ${
                !isAvailable
                  ? 'border-border opacity-40 cursor-not-allowed'
                  : isSelected
                    ? 'border-green-primary shadow-[0_0_15px_var(--color-green-glow)] cursor-pointer'
                    : 'border-border cursor-pointer hover:bg-bg-card-hover'
              }`}
            >
              <p className="text-text-secondary text-xs uppercase tracking-wider mb-1">
                {tier.label}
              </p>
              <p className="font-mono text-2xl font-bold text-text-primary">
                {tier.qsr}
              </p>
              <p className="text-text-muted text-xs mt-1">QSR</p>
              <p className="text-text-secondary text-[10px] mt-2">
                {isAvailable ? tier.description : 'Insufficient QSR'}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
