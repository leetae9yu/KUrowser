/** Calendar order of a term name like "2025학년도 여름학기": year, then 1학기, 여름, 2학기, 겨울. */
export function termOrder(name: string): number {
  const year = Number(name.match(/(\d{4})/)?.[1] ?? 0);
  const season = /여름/.test(name) ? 2 : /겨울/.test(name) ? 4 : /2\s*학기/.test(name) ? 3 : /1\s*학기/.test(name) ? 1 : 5;
  return year * 10 + season;
}
