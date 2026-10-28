/** Hasta 7 números; el resto se resume con "…" junto a la primera y la última página. */
export function pageWindow(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const start = Math.max(2, Math.min(page - 1, pages - 4));
  const end = Math.min(pages - 1, Math.max(page + 1, 5));
  const middle = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  return [1, ...(start > 2 ? (['…'] as const) : []), ...middle, ...(end < pages - 1 ? (['…'] as const) : []), pages];
}
