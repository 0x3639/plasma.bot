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
 * Quick regex check for z1 address format before SDK parsing.
 */
export function isValidAddressFormat(address: string): boolean {
  return /^z1[a-z0-9]{38}$/.test(address);
}
