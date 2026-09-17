import { Address } from 'znn-typescript-sdk';

/**
 * Validate a Zenon address string (z1... bech32 format).
 * Returns the parsed Address on success, null on failure.
 */
export function parseZenonAddress(address: string): Address | null {
  try {
    return Address.parse(address);
  } catch {
    return null;
  }
}

/**
 * Parse an address and return its canonical (lowercase bech32) string form,
 * or null if it is not a valid Zenon address.
 *
 * Bech32 accepts an all-uppercase encoding of the same address. Every
 * database lookup, lock and audit record must use this canonical form so
 * that `Z1...` and `z1...` are treated as the same beneficiary they are
 * on-chain.
 */
export function canonicalizeAddress(address: string): string | null {
  const parsed = parseZenonAddress(address);
  return parsed ? parsed.toString() : null;
}

/**
 * Quick regex check for z1 address format before SDK parsing.
 */
export function isValidAddressFormat(address: string): boolean {
  return /^z1[a-z0-9]{38}$/.test(address);
}
