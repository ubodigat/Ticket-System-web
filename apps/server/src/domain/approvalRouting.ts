/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/

// Automatischer Genehmigungsworkflow: wer eine Anfrage pruefen soll, in dieser Reihenfolge
//   1. die vorgesetzte Person des erstellenden Kontos
//   2. Ersatzperson der Ticket-Kategorie
//   3. Ersatzperson einer Gruppe des erstellenden Kontos (naechste Gruppe zuerst, dann Obergruppen)
//   4. allgemeine Ersatzperson
// Die Aufrufstelle nimmt die erste davon, die als aktives Konto existiert und nicht die
// erstellende Person ist; danach bleibt als letzte Reserve eine Superadmin-Person.

export interface FallbackRule { type: 'group' | 'category'; target: string; userId: string }

export function approverCandidates(input: {
  supervisorId: string | null | undefined;
  rules: FallbackRule[] | null | undefined;
  category: string | null | undefined;
  creatorGroupIds: string[];
  groups: Array<{ id: string; parent_id: string | null }>;
  globalFallbackId: string | null | undefined;
}): string[] {
  const rules = input.rules || [];
  const candidates: string[] = [];
  const add = (id: string | null | undefined) => { if (id && !candidates.includes(id)) candidates.push(id); };
  add(input.supervisorId);
  if (input.category) for (const rule of rules) if (rule.type === 'category' && rule.target === input.category) add(rule.userId);
  const parentOf = new Map(input.groups.map(group => [group.id, group.parent_id]));
  // Je Ebene: zuerst alle eigenen Gruppen, dann deren Obergruppen usw.
  let level = [...input.creatorGroupIds];
  const seen = new Set<string>();
  for (let depth = 0; level.length && depth < 32; depth++) {
    for (const groupId of level) {
      if (seen.has(groupId)) continue;
      seen.add(groupId);
      for (const rule of rules) if (rule.type === 'group' && rule.target === groupId) add(rule.userId);
    }
    level = level.map(id => parentOf.get(id)).filter((id): id is string => !!id && !seen.has(id));
  }
  add(input.globalFallbackId);
  return candidates;
}
