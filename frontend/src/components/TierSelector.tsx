type Tier = 'low' | 'medium' | 'high';

interface TierSelectorProps {
  selected: Tier | null;
  onSelect: (tier: Tier) => void;
  availableTiers?: string[];
}

const TIERS: { id: Tier; label: string; qsr: number }[] = [
  { id: 'low', label: 'LOW', qsr: 20 },
  { id: 'medium', label: 'MED', qsr: 80 },
  { id: 'high', label: 'HIGH', qsr: 120 },
];

export function TierSelector({ selected, onSelect, availableTiers }: TierSelectorProps) {
  return (
    <fieldset className="mb-6 min-w-0 border-0 p-0">
      <legend className="mb-1.5 block p-0 text-[11px] text-dim">TIER:</legend>
      <div className="grid grid-cols-3">
        {TIERS.map((tier) => {
          const isAvailable = !availableTiers || availableTiers.includes(tier.id);
          const isSelected = selected === tier.id;

          const state = !isAvailable
            ? 'bg-black text-ink opacity-40 cursor-not-allowed'
            : isSelected
              ? 'bg-ink text-black cursor-pointer'
              : 'bg-black text-ink hover:bg-faint cursor-pointer';

          return (
            <button
              key={tier.id}
              type="button"
              onClick={() => isAvailable && onSelect(tier.id)}
              disabled={!isAvailable}
              aria-pressed={isSelected}
              title={isAvailable ? undefined : 'Insufficient QSR'}
              className={`border border-ink px-2 py-3.5 text-center sm:px-3.5 ${state}`}
            >
              <span className="block text-[12px]">
                {isSelected ? '[x]' : '[ ]'} {tier.label}
              </span>
              <span className="block text-[20px] font-bold">{tier.qsr}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
