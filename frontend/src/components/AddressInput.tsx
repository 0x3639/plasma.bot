interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function AddressInput({ value, onChange, error }: AddressInputProps) {
  const isValid = value.length === 0 || /^z1[a-z0-9]{38}$/.test(value);
  const showError = value.length > 0 && !isValid;

  return (
    <div className="mb-5">
      <label htmlFor="address-input" className="block text-text-secondary text-xs mb-2 uppercase tracking-wider">
        Zenon Address
      </label>
      <div className="relative">
        <input
          id="address-input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          placeholder="z1qr39my..."
          className={`w-full bg-bg-input border rounded-lg px-4 py-3 font-mono text-sm text-text-primary placeholder-text-muted outline-none transition-colors ${
            showError || error
              ? 'border-error'
              : value && isValid
                ? 'border-green-primary'
                : 'border-border focus:border-border-focus'
          }`}
          spellCheck={false}
          autoComplete="off"
        />
        {value && isValid && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-primary text-lg">
            &#10003;
          </span>
        )}
      </div>
      {showError && (
        <p className="text-error text-xs mt-1">
          Invalid address. Must start with z1 and be 40 characters.
        </p>
      )}
      {error && <p className="text-error text-xs mt-1">{error}</p>}
    </div>
  );
}
