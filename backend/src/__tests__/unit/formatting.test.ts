import { describe, it, expect } from 'vitest';
import { formatError, formatFuseSuccess } from '../../telegram/formatting.js';

describe('telegram HTML escaping', () => {
  it('escapes HTML metacharacters in error messages', () => {
    const out = formatError('<script>alert(1)</script> & "quotes"');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&amp;');
    expect(out).toContain('&quot;');
    // The intentional <b> wrapper tag is preserved.
    expect(out.startsWith('<b>Error:</b>')).toBe(true);
  });

  it('escapes interpolated values in fuse success replies', () => {
    // txHash/tier are validated upstream today, but the formatter must be safe
    // by construction regardless of caller discipline.
    const out = formatFuseSuccess('z1test', '<b>evil</b>', 20, 'tx<script>');
    expect(out).toContain('tx&lt;script&gt;');
    expect(out).toContain('&lt;b&gt;evil&lt;/b&gt;');
  });

  it('does not double-escape ordinary addresses/hashes', () => {
    const out = formatFuseSuccess('z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0', 'low', 20, 'abc123');
    expect(out).toContain('abc123');
    expect(out).toContain('20 QSR');
    expect(out).not.toContain('&amp;');
  });
});
