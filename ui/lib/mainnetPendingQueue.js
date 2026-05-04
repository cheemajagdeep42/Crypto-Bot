/**
 * FIFO mainnet Jupiter sells from BFF (`pendingMainnetSells` + legacy `pendingMainnetSell`).
 * @param {Record<string, unknown> | null | undefined} row
 * @returns {unknown[]}
 */
export function pendingMainnetSellsList(row) {
  if (Array.isArray(row?.pendingMainnetSells) && row.pendingMainnetSells.length > 0) {
    return row.pendingMainnetSells;
  }
  if (row?.pendingMainnetSell) return [row.pendingMainnetSell];
  return [];
}

/** @param {Record<string, unknown> | null | undefined} row */
export function hasPendingMainnetSells(row) {
  return pendingMainnetSellsList(row).length > 0;
}
