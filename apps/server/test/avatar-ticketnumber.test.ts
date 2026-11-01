import { describe, expect, it } from 'vitest';
import { avatarDescriptor, inspectAvatarImage } from '../src/domain/avatar.js';
import { buildTicketNumber, ticketNumberCategoryCode, ticketNumberFormatProblem } from '../src/domain/ticketNumber.js';

function png(width: number, height: number) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function jpeg(width: number, height: number) {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
}

describe('profile pictures', () => {
  it('accepts small PNG and JPEG images by their signature', () => {
    expect(inspectAvatarImage(png(256, 256))).toEqual({ mime: 'image/png', width: 256, height: 256 });
    expect(inspectAvatarImage(jpeg(200, 150))).toEqual({ mime: 'image/jpeg', width: 200, height: 150 });
  });
  it('rejects SVG, HTML, oversized dimensions and oversized files', () => {
    expect(inspectAvatarImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))).toBeNull();
    expect(inspectAvatarImage(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(inspectAvatarImage(png(20000, 20000))).toBeNull();
    expect(inspectAvatarImage(Buffer.concat([png(10, 10), Buffer.alloc(400 * 1024)]))).toBeNull();
  });
  it('describes presets and custom images without exposing data', () => {
    expect(avatarDescriptor({ avatar_preset: 3 })).toEqual({ preset: 3, custom: null });
    expect(avatarDescriptor({ avatar_preset: 9 })).toEqual({ preset: null, custom: null });
    expect(avatarDescriptor({ avatar_mime: 'image/png', avatar_updated_at: new Date(5000) })).toEqual({ preset: null, custom: 5000 });
  });
});

describe('ticket number building blocks', () => {
  const now = new Date('2026-03-05T10:00:00Z');
  it('fills date tokens in the configured time zone and uses custom category codes', () => {
    expect(buildTicketNumber(42, 'Hardware', {
      ticketNumberFormat: { prefix: 'TS', padding: 4, format: '{prefix}-{year}{month}-{category}-{number}' },
      ticketNumberCategoryCodes: { Hardware: 'hw' }
    }, now)).toBe('TS-202603-HW-0042');
    expect(buildTicketNumber(1, null, { ticketNumberFormat: { format: '{yy}/{day}/{number}', padding: 3 }, companyBrandingConfig: { timezone: 'UTC' } }, now)).toBe('26/05/001');
    expect(ticketNumberCategoryCode('Hardware', { Hardware: 'bad code!' })).toBe('HARDWARE');
  });
  it('rejects templates whose running number could not be read back reliably', () => {
    expect(ticketNumberFormatProblem('{prefix}-{category}')).toBe('missing_number');
    expect(ticketNumberFormatProblem('{number}-{year}')).toBe('number_position');
    expect(ticketNumberFormatProblem('{year}{number}')).toBe('number_position');
    expect(ticketNumberFormatProblem('TS2{number}')).toBe('number_position');
    expect(ticketNumberFormatProblem('{number}-{number}')).toBe('number_twice');
    expect(ticketNumberFormatProblem('{prefix}-{nummer}-{number}')).toBe('unknown_token');
    expect(ticketNumberFormatProblem('<b>{number}')).toBe('invalid_character');
    expect(ticketNumberFormatProblem('{prefix}-{year}-{number}')).toBeNull();
    expect(ticketNumberFormatProblem('TS{number}')).toBeNull();
  });
  it('falls back to the plain number for an invalid template', () => {
    expect(buildTicketNumber(7, null, { ticketNumberFormat: { padding: 3, format: '{number}-{year}' } }, now)).toBe('007');
  });
});
