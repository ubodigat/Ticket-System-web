// Benutzergruppen mit Untergruppen (groups.parent_id).
export const MAX_GROUP_DEPTH = 5;

type GroupNode = { id: string; parent_id: string | null };

// Gruppe samt aller (auch indirekten) Untergruppen -- z.B. damit ein an "IT" geroutetes Ticket
// auch die Mitglieder von "IT > Netzwerk" erreicht.
export function groupWithDescendants(groupId: string, groups: GroupNode[]): string[] {
  const result = [groupId];
  for (let index = 0; index < result.length; index++) {
    for (const group of groups) {
      if (group.parent_id === result[index] && !result.includes(group.id)) result.push(group.id);
    }
  }
  return result;
}

// Prueft eine neue uebergeordnete Gruppe: muss existieren, darf weder die Gruppe selbst noch eine
// ihrer Untergruppen sein (keine Zyklen), und die Verschachtelung bleibt auf MAX_GROUP_DEPTH Ebenen.
export function validateGroupParent(groupId: string | null, parentId: string | null, groups: GroupNode[]): string | null {
  if (!parentId) return null;
  const byId = new Map(groups.map(group => [group.id, group.parent_id]));
  if (!byId.has(parentId)) return 'invalid_parent';
  if (groupId && groupWithDescendants(groupId, groups).includes(parentId)) return 'group_cycle';
  let ancestors = 0;
  const seen = new Set<string>();
  for (let current: string | null = parentId; current && !seen.has(current); current = byId.get(current) ?? null) {
    seen.add(current);
    ancestors++;
  }
  const height = (id: string, path: Set<string>): number => {
    if (path.has(id)) return 0;
    const next = new Set(path).add(id);
    return 1 + Math.max(0, ...groups.filter(group => group.parent_id === id).map(group => height(group.id, next)));
  };
  const ownHeight = groupId ? height(groupId, new Set()) : 1;
  return ancestors + ownHeight > MAX_GROUP_DEPTH ? 'group_too_deep' : null;
}
