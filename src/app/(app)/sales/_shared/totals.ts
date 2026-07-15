export type LineItemInput = {
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
};

export function computeTotals(items: LineItemInput[]) {
  let subtotal = 0;
  let taxTotal = 0;
  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || 0;
    const rate = Number(item.taxRatePercent) || 0;
    const line = qty * price;
    subtotal += line;
    taxTotal += line * (rate / 100);
  }
  const total = subtotal + taxTotal;
  return {
    subtotal: subtotal.toFixed(2),
    taxTotal: taxTotal.toFixed(2),
    total: total.toFixed(2),
  };
}

export function fmt(n: string | number) {
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
