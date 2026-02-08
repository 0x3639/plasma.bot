import { describe, it, expect } from 'vitest';
import { sanitize } from '../../utils/logger.js';

describe('sanitize', () => {
  it('redacts mnemonic phrases (12+ words)', () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const result = sanitize(mnemonic);
    expect(result).toBe('[MNEMONIC_REDACTED]');
  });

  it('redacts KEYFILE_PASSWORD patterns', () => {
    const result = sanitize('KEYFILE_PASSWORD=my-secret-pass');
    // Generic pattern catches "password=" before the specific KEYFILE_PASSWORD pattern
    expect(result).toBe('KEYFILE_[SENSITIVE_REDACTED]');
  });

  it('redacts ADMIN_API_KEY patterns', () => {
    const result = sanitize('ADMIN_API_KEY=super-secret-key-123');
    // Generic pattern catches "admin_api_key=" before the specific pattern
    expect(result).toBe('[SENSITIVE_REDACTED]');
  });

  it('redacts private_key patterns', () => {
    const result = sanitize('private_key: abc123def456');
    expect(result).toBe('[SENSITIVE_REDACTED]');
  });

  it('redacts password patterns in strings', () => {
    const result = sanitize('password=hunter2');
    expect(result).toBe('[SENSITIVE_REDACTED]');
  });

  it('passes non-sensitive strings unchanged', () => {
    const result = sanitize('Normal log message about QSR balance');
    expect(result).toBe('Normal log message about QSR balance');
  });

  it('redacts object keys containing password', () => {
    const result = sanitize({ password: 'hunter2', name: 'alice' });
    expect(result).toEqual({ password: '[REDACTED]', name: 'alice' });
  });

  it('redacts object keys containing mnemonic', () => {
    const result = sanitize({ mnemonic: 'abandon...', status: 'ok' });
    expect(result).toEqual({ mnemonic: '[REDACTED]', status: 'ok' });
  });

  it('redacts object keys containing privatekey', () => {
    const result = sanitize({ privateKey: '0xabc', data: 42 });
    expect(result).toEqual({ privateKey: '[REDACTED]', data: 42 });
  });

  it('redacts object keys containing apikey', () => {
    const result = sanitize({ apiKey: 'key-123', tier: 'low' });
    expect(result).toEqual({ apiKey: '[REDACTED]', tier: 'low' });
  });

  it('redacts object keys containing api_key', () => {
    const result = sanitize({ api_key: 'key-123', tier: 'low' });
    expect(result).toEqual({ api_key: '[REDACTED]', tier: 'low' });
  });

  it('handles null/undefined gracefully', () => {
    expect(sanitize(null)).toBe(null);
    expect(sanitize(undefined)).toBe(undefined);
  });

  it('handles numbers unchanged', () => {
    expect(sanitize(42)).toBe(42);
  });

  it('sanitizes Error objects', () => {
    const error = new Error('password=secret123 leaked');
    const result = sanitize(error) as { message: unknown; stack: unknown };
    expect(result.message).toBe('[SENSITIVE_REDACTED] leaked');
  });
});
