/** The week a folder or title names ("3주차", "Week 3"); null when it names none. */
export function weekOf(label: string): number | null {
  const m = label.match(/(\d{1,2})\s*주\s*차/) ?? label.match(/week\s*(\d{1,2})/i);
  return m ? Number(m[1]) : null;
}

/** Items in groups by a label, groups in week order; labels with no week keep their first-seen order at the end. */
export function byWeek<T>(items: T[], label: (item: T) => string): Array<{ label: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = label(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups]
    .map(([key, list], order) => ({ label: key, items: list, week: weekOf(key), order }))
    .sort((a, b) => (a.week ?? Infinity) - (b.week ?? Infinity) || a.order - b.order)
    .map(({ label: key, items: list }) => ({ label: key, items: list }));
}
