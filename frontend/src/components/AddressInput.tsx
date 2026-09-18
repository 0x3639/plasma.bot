interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function AddressInput({ value, onChange, error }: AddressInputProps) {
  const isValid = value.length === 0 || /^z1[a-z0-9]{38}$/.test(value);
  const showError = value.length > 0 && !isValid;

  return (
    <div className="mb-3.5">
      <label htmlFor="address-input" className="mb-1.5 block text-[11px] text-dim">
        ZENON_ADDRESS:
      </label>
      <div
        className={`mb-1.5 flex items-center border focus-within:bg-faint focus-within:shadow-[inset_0_0_0_1px_var(--color-ink)] ${
          showError || error ? 'border-error focus-within:shadow-[inset_0_0_0_1px_var(--color-error)]' : 'border-ink'
        }`}
      >
        <span className="pl-3 text-[13px] text-dim" aria-hidden="true">&gt;</span>
        <input
          id="address-input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          placeholder="z1_"
          className="min-w-0 flex-1 border-none bg-transparent p-3 text-[13px] text-ink outline-none placeholder:text-dim"
          spellCheck={false}
          autoComplete="off"
        />
        {value && isValid && <span className="pr-3 text-[13px] text-ink">OK</span>}
      </div>
      {showError && (
        <p className="text-[11px] text-error">ERR: invalid address — must start with z1 and be 40 chars</p>
      )}
      {error && <p className="text-[11px] text-error">ERR: {error}</p>}
    </div>
  );
}
