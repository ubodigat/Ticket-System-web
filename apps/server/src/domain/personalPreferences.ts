import { z } from 'zod';

// Raster images only: SVG, external URLs and executable CSS are never synced.
export const preferencePatchSchema = z.object({
  theme: z.enum(['dark', 'light']).optional(),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  lang: z.enum(['de', 'en']).optional(),
  reportingConfig: z.object({ personal: z.boolean() }).strict().optional(),
  bgType: z.enum(['default', 'class', 'color', 'image']).optional(),
  bgValue: z.string().max(5_600_000).refine(value => value === ''
    || /^bg-[a-z-]{1,40}$/.test(value)
    || /^#[0-9a-f]{6}$/i.test(value)
    || /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(value), 'Invalid background').optional(),
  collapsedSections: z.record(z.string().regex(/^[a-z0-9:-]{1,100}$/), z.boolean()).refine(v => Object.keys(v).length <= 150).optional()
}).strict();

export function mergePreferences(current: Record<string, unknown>, patch: z.infer<typeof preferencePatchSchema>) {
  return { ...current, ...patch, ...(patch.collapsedSections ? {
    collapsedSections: { ...(current.collapsedSections as Record<string, boolean> || {}), ...patch.collapsedSections }
  } : {}) };
}
