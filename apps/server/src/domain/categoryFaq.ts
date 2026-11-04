/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import { z } from 'zod';

// Schnelle Tipps je Kategorie (F&A): erscheinen im Benutzer-Dashboard vor dem Ticketformular.
// Reiner Text; die Oberflaeche maskiert alles und erlaubt nur den einfachen Markdown-Dialekt.
export const categoryFaqSchema = z.object({
  intro: z.string().trim().max(2000).default(''),
  items: z.array(z.object({
    question: z.string().trim().min(1).max(300),
    answer: z.string().trim().min(1).max(5000)
  }).strict()).max(30).default([])
}).strict();
export type CategoryFaq = z.infer<typeof categoryFaqSchema>;

export function parseCategoryFaq(json: string | null | undefined): CategoryFaq {
  try {
    const parsed = categoryFaqSchema.safeParse(json ? JSON.parse(json) : {});
    return parsed.success ? parsed.data : { intro: '', items: [] };
  } catch {
    return { intro: '', items: [] };
  }
}

// Auswirkung (1 nur ich .. 3 Abteilung) x Dringlichkeit (1 kann warten .. 3 Arbeit unmoeglich).
export function priorityFromImpact(impact: number, urgency: number): 'Niedrig' | 'Normal' | 'Hoch' {
  const score = impact + urgency;
  return score >= 5 ? 'Hoch' : score >= 4 ? 'Normal' : 'Niedrig';
}
