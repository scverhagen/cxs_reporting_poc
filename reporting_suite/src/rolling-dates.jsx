import { rollingDays, rollingRange, selectedRollingPeriod } from "./metrics";
import { useView } from "./view-state";

export function RollingDates({ tab, filters, options, asOf }) {
  const { output } = useView();
  const period = selectedRollingPeriod(tab, filters, options);
  const days = rollingDays[period];
  if (!days) return null;
  const range = rollingRange(period, filters.runDay);
  return output ? (
    <>
      <span
        data-filter="Rolling period"
        data-value={"Last " + days + " days"}
      />
      <span data-filter="Window from (UTC)" data-value={range.start} />
      <span data-filter="Window through (UTC)" data-value={range.end} />
    </>
  ) : (
    <p className="text-sm text-muted-foreground">
      <strong className="font-medium text-foreground">Last {days} days</strong>{" "}
      · {range.start} through {range.end} UTC.{" "}
      {range.end > asOf && "Sample records are current through " + asOf + "."}
    </p>
  );
}
