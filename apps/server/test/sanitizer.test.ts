import { describe, expect, it } from 'vitest';
import { sanitizeServerHtml } from '../src/domain/sanitizer.js';

describe('server-side HTML sanitization (Zero-Trust Browser Principle)', () => {
  it('strips script tags and executable JavaScript', () => {
    const malicious = '<p>Hallo</p><script>alert("XSS")</script><script src="https://evil.com/payload.js"></script>';
    const cleaned = sanitizeServerHtml(malicious);
    expect(cleaned).not.toContain('<script');
    expect(cleaned).not.toContain('alert');
    expect(cleaned).toContain('<p>Hallo</p>');
  });

  it('strips inline event handlers (onclick, onerror, onload)', () => {
    const malicious = '<img src="x" onerror="alert(1)"><a href="https://example.com" onclick="stealCookies()">Link</a>';
    const cleaned = sanitizeServerHtml(malicious);
    expect(cleaned).not.toContain('onerror');
    expect(cleaned).not.toContain('onclick');
    expect(cleaned).not.toContain('stealCookies');
    expect(cleaned).toContain('href="https://example.com"');
    expect(cleaned).toContain('rel="noopener noreferrer"');
  });

  it('neutralizes javascript: URIs', () => {
    const malicious = '<a href="javascript:alert(document.cookie)">Klick mich</a>';
    const cleaned = sanitizeServerHtml(malicious);
    expect(cleaned).not.toContain('javascript:');
  });

  it('preserves safe formatting elements and tables', () => {
    const safe = '<p><strong>Wichtig:</strong> Bitte <em>prüfen</em>. <code>const x = 1;</code></p><table><thead><tr><th>Spalte</th></tr></thead><tbody><tr><td>Wert</td></tr></tbody></table>';
    const cleaned = sanitizeServerHtml(safe);
    expect(cleaned).toContain('<strong>Wichtig:</strong>');
    expect(cleaned).toContain('<em>prüfen</em>');
    expect(cleaned).toContain('<code>const x = 1;</code>');
    expect(cleaned).toContain('<table>');
    expect(cleaned).toContain('<td>Wert</td>');
  });

  it('handles null, undefined, or empty inputs gracefully', () => {
    expect(sanitizeServerHtml(null)).toBe('');
    expect(sanitizeServerHtml(undefined)).toBe('');
    expect(sanitizeServerHtml('')).toBe('');
  });
});
