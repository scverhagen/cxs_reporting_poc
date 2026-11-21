import { loginMeasures, loginReading } from "./login-metrics";
import { fundingPeriod, fundingPoints } from "./funding";
import { ComparedPlot } from "./period-charts";
import { GridTable, Panel, Filter } from "./shared";
import { DateField, fmt, money, sum } from "./report-tools";
import {
  measure,
  milestoneRows,
  ordersInScope,
  comparisonRange,
  recognitionEvents,
  reportRange,
  rollingDays,
  shortDate,
  walletInScope,
} from "./metrics";
import { orgScope, useView } from "./view-state";

export const comparableReports = [
  "activity",
  "categories",
  "performance",
  "leaders",
  "investigation",
  "logins",
  "participation",
  "wallets",
  "orders",
  "awards",
  "funding",
];

export function CompareFilter({ filters, setFilters, asOf }) {
  const { output } = useView();
  const change = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  return (
    <>
      <Filter
        label="Compare to"
        value={filters.compare || "off"}
        options={[
          ["off", "No comparison"],
          ["previous", "Previous period"],
          ["custom", "Custom dates"],
        ]}
        onChange={(value) => change("compare", value)}
      />
      {filters.compare === "custom" && !output && (
        <>
          <DateField
            name="Comparison from"
            value={filters.comparisonStart}
            max={asOf}
            onChange={(v) => change("comparisonStart", v)}
          />
          <DateField
            name="Comparison through"
            value={filters.comparisonEnd}
            max={asOf}
            onChange={(v) => change("comparisonEnd", v)}
          />
        </>
      )}
    </>
  );
}

export function ComparisonDatePrompt({ asOf }) {
  return (
    <p role="alert">
      Choose a comparison start and end between Jan 1 and{" "}
      {shortDate(asOf) + ", " + asOf.slice(0, 4)}, with the end on or after the
      start.
    </p>
  );
}

// Evaluate both windows through the same report filters and already-authorized records.
export function periodReadings(
  reports,
  range,
  filters,
  asOf,
  options = {},
  tag = null,
) {
  const { start, end } = range;
  const metrics = [];
  const add = (tab, label, value, hint, unit = "number") =>
    metrics.push({ tab, label, value, hint, unit });
  const readings = { metrics, asOf };
  for (const [tab, data] of Object.entries(reports)) {
    const scope = orgScope(filters.org, data.orgs);
    if (tab === "activity" || tab === "participation") {
      const events = recognitionEvents(
        data,
        tab,
        start,
        end,
        scope,
        filters.program,
        tag,
      );
      if (tab === "activity") {
        readings.events = events;
        add(tab, "Approved recognitions", events.length, "By approval date");
        add(
          tab,
          "Points awarded",
          sum(events, (e) => e.points),
          "Across approved recognitions",
        );
      } else {
        readings.participants = events;
        for (const direction of ["send", "receive"]) {
          const { active, total } = measure(
            data,
            events,
            start,
            end,
            scope,
            filters.program,
            direction,
          );
          add(
            tab,
            direction === "send"
              ? "Sending participation"
              : "Receiving participation",
            total ? (100 * active) / total : null,
            active +
              " of " +
              total +
              " eligible " +
              (direction === "send" ? "senders" : "recipients"),
            "rate",
          );
        }
      }
    }
    if (tab === "logins") {
      const login = loginReading(data, range, scope);
      readings.loginEvents = login?.loginEvents ?? [];
      for (const [key, label, hint] of loginMeasures)
        add(tab, label, login?.[key], hint);
    }
    if (tab === "funding") {
      const budget = fundingPeriod(
        data,
        start,
        end,
        scope,
        options.program ?? filters.program,
        options.bank,
      );
      readings.banks = budget.banks;
      readings.fundingAwards = budget.awards;
      add(
        tab,
        "Remaining budget",
        fundingPoints(budget.tx),
        "Points across selected banks at period end",
      );
      add(
        tab,
        "Award spending",
        -fundingPoints(budget.awards),
        "Points funded for selected senders",
      );
    }
    if (tab === "wallets") {
      const balanceDate = end > asOf ? asOf : end;
      const wallet = walletInScope(data, balanceDate, scope, options.search);
      readings.tx = wallet.tx;
      readings.hasWalletPopulation = wallet.employees.length > 0;
      add(
        tab,
        "Points balance",
        sum(readings.tx, (t) => t.points_delta),
        end > asOf ? "At snapshot date" : "At period end",
      );
    }
    if (tab === "orders") {
      readings.orderRows = ordersInScope(
        data,
        start,
        end,
        scope,
        options.source,
        options.status,
      );
      add(
        tab,
        "Orders placed",
        readings.orderRows.length,
        "By submission date",
      );
      add(
        tab,
        "Item units",
        sum(readings.orderRows, (r) => r.item_units),
        "Across submitted orders",
      );
      if (data.viewer.can_view_order_value)
        add(
          tab,
          "Order value",
          sum(readings.orderRows, (r) => r.value_minor || 0),
          "Gross submitted value",
          "money",
        );
    }
    if (tab === "awards") {
      readings.awardRows = milestoneRows(
        data,
        { ...filters, start, end, eligibilityPeriod: "custom" },
        asOf,
        scope,
      );
      add(
        tab,
        "Milestone awards",
        readings.awardRows.length,
        "Eligible during period",
      );
    }
  }
  return readings;
}

export function metricValue(data, metric, change = false) {
  if (metric.value == null) return "—";
  const n = metric.value;
  const prefix = change && n > 0 ? "+" : "";
  if (metric.unit === "money") return prefix + money(data, n);
  if (metric.unit === "rate")
    return (
      prefix +
      n.toLocaleString("en-US", { maximumFractionDigits: 1 }) +
      (change ? " pp" : "%")
    );
  return prefix + fmt(n);
}

export function metricChange(data, current, previous) {
  return metricValue(
    data,
    {
      ...current,
      value:
        previous?.value == null || current.value == null
          ? null
          : current.value - previous.value,
    },
    true,
  );
}

export function rangeLabel({ start, end }) {
  const startYear =
    start.slice(0, 4) === end.slice(0, 4) ? "" : ", " + start.slice(0, 4);
  return (
    shortDate(start) +
    startYear +
    " – " +
    shortDate(end) +
    ", " +
    end.slice(0, 4)
  );
}

export function ComparisonDates({ current, previous }) {
  const { output } = useView();
  const unavailable = previous.start < "2026-01-01";
  const reason =
    "Previous period unavailable. Sample history starts Jan 1, 2026.";
  if (output)
    return (
      <>
        <span
          data-filter="Comparison"
          data-value={
            previous.label === "Previous" ? "Previous period" : "Custom dates"
          }
        />
        <span data-filter="Current from" data-value={current.start} />
        <span data-filter="Current through" data-value={current.end} />
        <span
          data-filter={previous.label + " from"}
          data-value={previous.start}
        />
        <span
          data-filter={previous.label + " through"}
          data-value={previous.end}
        />
        {unavailable && (
          <span data-filter="Comparison availability" data-value={reason} />
        )}
      </>
    );
  return (
    <p className="text-sm text-muted-foreground" role="status">
      <b className="font-medium text-foreground">{rangeLabel(current)}</b>{" "}
      compared with{" "}
      <b className="font-medium text-foreground">{rangeLabel(previous)}</b>
      {unavailable && <span className="block">{reason}</span>}
    </p>
  );
}

export function ComparisonTable({ data, metrics, previous, label }) {
  return (
    <Panel
      title="Period comparison"
      caption={
        "Absolute change from the " +
        label.toLowerCase() +
        " period." +
        (metrics.some((metric) => metric.unit === "rate")
          ? " Participation changes are in percentage points."
          : "")
      }
    >
      <GridTable
        fixed
        heads={["Metric", "Current", label, "Change"]}
        rows={metrics.map((metric, i) => [
          metric.label,
          metricValue(data, metric),
          previous ? metricValue(data, previous[i]) : "—",
          metricChange(data, metric, previous?.[i]),
        ])}
      />
    </Panel>
  );
}

export function ReportComparison({ tab, data, filters, asOf, tag, children }) {
  const { options, output } = useView();
  if (
    filters.compare === "off" ||
    !comparableReports.includes(tab) ||
    output === "recipients"
  )
    return children;
  const catalogDates = ["wallets", "orders", "funding"].includes(tab);
  const period = rollingDays[options.dateMode]
    ? options.dateMode
    : tab === "awards"
      ? filters.eligibilityPeriod
      : filters.period;
  const current = reportRange(tab, filters, options, asOf);
  if (!current)
    return (
      <>
        <p
          className="text-sm text-muted-foreground"
          data-filter="Comparison"
          data-value="Select an eligibility period to compare"
        >
          Select an eligibility period to compare awards.
        </p>
        {children}
      </>
    );
  if (
    !current.start ||
    !current.end ||
    current.start > current.end ||
    current.start < "2026-01-01" ||
    (!rollingDays[period] && current.end > asOf)
  )
    return children;
  const previous = comparisonRange(current, filters, asOf, period);
  if (!previous)
    return filters.compare === "custom" ? (
      <ComparisonDatePrompt asOf={asOf} />
    ) : (
      children
    );
  const settings = catalogDates
    ? { ...filters, org: options.org || "" }
    : filters;
  const read = (range) =>
    periodReadings({ [tab]: data }, range, settings, asOf, options, tag);
  const readings = read(current);
  const prior = previous.start >= "2026-01-01" ? read(previous) : null;
  return (
    <>
      <ComparisonDates current={current} previous={previous} />
      <ComparisonTable
        data={data}
        metrics={readings.metrics}
        label={previous.label}
        previous={prior?.metrics}
      />
      <ComparedPlot.Provider
        value={{
          tab,
          data,
          current,
          previous,
          readings,
          prior,
          filters: settings,
        }}
      >
        {children}
      </ComparedPlot.Provider>
    </>
  );
}
