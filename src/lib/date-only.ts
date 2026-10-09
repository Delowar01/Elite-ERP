/**
 * Calendar arithmetic on "YYYY-MM-DD" business dates — issue, validity and delivery dates.
 *
 * A business date is a day on the calendar, not an instant: 2026-10-09 + 30 days is 2026-11-08
 * whatever time zone the browser, the server or the host runs in. So the date is read at UTC
 * midnight and moved with the UTC calendar. Reading it at LOCAL midnight and writing it back out
 * in UTC — what the date dialogs used to do — lands on the day before anywhere ahead of UTC
 * (Riyadh, Dhaka). docs/ui/pre-dev-ui-01-7/business-date-determinism.md
 */

/** `isoDate` plus `days` calendar days (negative goes back), as "YYYY-MM-DD". An unparseable date comes back unchanged. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
