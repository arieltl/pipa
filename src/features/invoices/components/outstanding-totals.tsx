import { formatMoney } from "../../../domain/money.ts";
import type { OutstandingTotal } from "../../../domain/outstanding-totals.ts";

/** Consistent currency-separated outstanding presentation for summary cards. */
export function OutstandingTotals({
  totals,
  emptyCurrency,
}: {
  totals: OutstandingTotal[];
  emptyCurrency: string;
}) {
  const displayTotals = totals.length > 0
    ? totals
    : [{ currency: emptyCurrency, totalMinor: 0 }];

  return (
    <div data-outstanding-totals class="space-y-0.5">
      {displayTotals.map((total) => (
        <div>{formatMoney(total.totalMinor, total.currency)}</div>
      ))}
    </div>
  );
}
