import { recognitionPeriod, comparisonRange, rollingDays } from "./metrics";
import { Filter } from "./shared";
import { DateField } from "./report-tools";
import { CompareFilter } from "./period-comparison";
import { periods, useView } from "./view-state";

export function summaryPeriod(filters, asOf) {
  const current = recognitionPeriod(filters, asOf);
  const { start, end } = current;
  const valid =
    start &&
    end &&
    start >= "2026-01-01" &&
    start <= end &&
    (rollingDays[filters.period] || end <= asOf);
  return {
    current,
    valid,
    previous: valid ? comparisonRange(current, filters, asOf) : null,
  };
}

export function SummaryControls({ data, filters, setFilters, asOf, children }) {
  const { output } = useView();
  const { start, end } = recognitionPeriod(filters, asOf);
  const change = (key, value) =>
    setFilters((old) => ({ ...old, [key]: value }));
  return (
    <div className="overview-filters">
      <Filter
        label="Reporting period"
        value={filters.period}
        options={periods(asOf)}
        onChange={(v) => change("period", v)}
      />
      {(output || filters.period === "custom") && (
        <>
          <DateField
            name="From"
            value={start}
            max={asOf}
            onChange={(v) => change("start", v)}
          />
          <DateField
            name="Through"
            value={end}
            max={asOf}
            onChange={(v) => change("end", v)}
          />
        </>
      )}
      <CompareFilter {...{ filters, setFilters, asOf }} />
      <Filter
        label="Organization"
        value={filters.org}
        options={[
          [
            "",
            data.viewer.role === "admin"
              ? "All organizations"
              : "All visible organizations",
          ],
          ...data.orgs
            .filter((o) => o.org_id !== "root")
            .map((o) => [o.org_id, o.name]),
        ]}
        onChange={(v) => change("org", v)}
      />
      {children}
    </div>
  );
}
