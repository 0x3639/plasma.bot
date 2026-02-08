import { describe, it, expect } from 'vitest';
import { isValidAddressFormat } from '../../utils/address.js';
import { fuseRequestSchema } from '../../middleware/validate.js';

describe('isValidAddressFormat', () => {
  it('accepts a valid z1 address', () => {
    expect(isValidAddressFormat('z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0')).toBe(true);
  });

  it('rejects address without z1 prefix', () => {
    expect(isValidAddressFormat('a1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0')).toBe(false);
  });

  it('rejects uppercase characters', () => {
    expect(isValidAddressFormat('z1QRJDHY65ZDS69A96XLHHEU4SY689K34X4HPSE0')).toBe(false);
  });

  it('rejects too short address', () => {
    expect(isValidAddressFormat('z1qrjdhy65zds69a')).toBe(false);
  });

  it('rejects too long address', () => {
    expect(isValidAddressFormat('z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0extra')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidAddressFormat('')).toBe(false);
  });

  it('rejects special characters', () => {
    expect(isValidAddressFormat('z1qrjdhy65zds69a96xlhheu4sy689k34x4hps!0')).toBe(false);
  });

  it('rejects address with spaces', () => {
    expect(isValidAddressFormat('z1 qrjdhy65zds69a96xlhheu4sy689k34x4hpse')).toBe(false);
  });
});

describe('fuseRequestSchema', () => {
  it('accepts valid body', () => {
    const result = fuseRequestSchema.safeParse({
      address: 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0',
      tier: 'low',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing address', () => {
    const result = fuseRequestSchema.safeParse({ tier: 'low' });
    expect(result.success).toBe(false);
  });

  it('rejects missing tier', () => {
    const result = fuseRequestSchema.safeParse({
      address: 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid tier value', () => {
    const result = fuseRequestSchema.safeParse({
      address: 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0',
      tier: 'ultra',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toBe('Tier must be low, medium, or high');
    }
  });

  it('strips extra fields', () => {
    const result = fuseRequestSchema.safeParse({
      address: 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0',
      tier: 'low',
      extraField: 'should be removed',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extraField');
    }
  });

  it('rejects numeric tier', () => {
    const result = fuseRequestSchema.safeParse({
      address: 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0',
      tier: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects address with bad format', () => {
    const result = fuseRequestSchema.safeParse({
      address: 'not-an-address',
      tier: 'low',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid tier values', () => {
    for (const tier of ['low', 'medium', 'high']) {
      const result = fuseRequestSchema.safeParse({
        address: 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0',
        tier,
      });
      expect(result.success).toBe(true);
    }
  });
});
