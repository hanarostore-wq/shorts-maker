export type FinanceSummary = {
  profit: number;
  loss: number;
  fees: number;
  net: number;
  basis?: string;
};

/** 원화 표시·계산 기준: 10원 미만은 절삭한다. 음수도 0 방향으로 절삭한다. */
export function truncateWon(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value / 10) * 10;
}

/** 총순익은 이익에서 손실과 비용을 차감해 다시 계산한다. */
export function normalizeFinance(row?: Partial<FinanceSummary> | null): FinanceSummary | null {
  if (!row || [row.profit, row.loss, row.fees].every((value) => value == null || !Number.isFinite(Number(value)))) return null;
  const profit = truncateWon(Number(row.profit || 0));
  const loss = truncateWon(Math.abs(Number(row.loss || 0)));
  const fees = truncateWon(Math.abs(Number(row.fees || 0)));
  return { profit, loss, fees, net: truncateWon(profit - loss - fees), basis: row.basis };
}

export function sumFinance(rows: Array<Partial<FinanceSummary> | null | undefined>): FinanceSummary | null {
  const normalized = rows.map(normalizeFinance).filter((row): row is FinanceSummary => Boolean(row));
  if (!normalized.length) return null;
  return normalizeFinance({
    profit: normalized.reduce((sum, row) => sum + row.profit, 0),
    loss: normalized.reduce((sum, row) => sum + row.loss, 0),
    fees: normalized.reduce((sum, row) => sum + row.fees, 0),
  });
}

export function formatWon(value?: number | null): string {
  return value == null ? "미집계" : `${truncateWon(value).toLocaleString("ko-KR")}원`;
}
