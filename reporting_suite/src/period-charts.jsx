import { usePlotSize } from "./use-plot-size";
import { createContext, useContext, useState } from "react";
import { GridTable, Panel } from "./shared";
import { day, dayMs, iso, measure, shortDate } from "./metrics";
import { orgScope, useView } from "./view-state";

export const ComparedPlot = createContext(null);

export function ReportPlot({ children }) {
  const comparison = useContext(ComparedPlot);
  return comparison ? <PeriodChart {...comparison} /> : (children ?? null);
}

export const chartTitles = {
  logins: "Logins over time",
  funding: "Award spending over time",
  activity: "Recognition over time",
  orders: "Orders over time",
  wallets: "Points balance over time",
  awards: "Milestone awards by status",
  participation: "Participation by program",
};
const units = {
  logins: "Successful logins",
  funding: "Funded points",
  activity: "Approved recognitions",
  orders: "Orders submitted",
  wallets: "Closing points balance",
};
const format = (n) =>
  n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 1 });

// Keep actual dates alongside elapsed-day positions, including the unmatched day
// when the two calendar months have different lengths.
function dailyRows(range) {
  const first = +day(range.start);
  const count = 1 + (+day(range.end) - first) / dayMs;
  return Array.from({ length: count }, (_, i) => ({
    date: iso(new Date(first + i * dayMs)),
    value: null,
  }));
}

export function dailyLedgerBalances(range, ledger, asOf) {
  const rows = dailyRows(range);
  if (!ledger) return rows;
  let balance = 0;
  const deltas = new Map();
  for (const entry of ledger) {
    const date = entry.occurred_at.slice(0, 10);
    if (date < range.start) balance += entry.points_delta;
    else deltas.set(date, (deltas.get(date) || 0) + entry.points_delta);
  }
  for (const row of rows) {
    balance += deltas.get(row.date) || 0;
    if (row.date <= asOf) row.value = balance;
  }
  return rows;
}

function dailyValues(tab, range, readings) {
  if (tab === "wallets") {
    return dailyLedgerBalances(
      range,
      readings?.hasWalletPopulation ? readings.tx : null,
      readings?.asOf,
    );
  }
  const rows = dailyRows(range);
  if (!readings) return rows;
  const records = {
    activity: readings.events,
    orders: readings.orderRows,
    funding: readings.fundingAwards,
    logins: readings.loginEvents,
  }[tab];
  const first = +day(range.start);
  for (const row of rows) if (row.date <= readings.asOf) row.value = 0;
  for (const record of records) {
    const date = (record.occurred_at ?? record.at ?? record.submitted_at).slice(
      0,
      10,
    );
    const row = rows[(+day(date) - first) / dayMs];
    if (row && row.value !== null)
      row.value += tab === "funding" ? -record.points_delta : 1;
  }
  return rows;
}

export function alignPeriodDays(current, previous) {
  return Array.from(
    { length: Math.max(current.length, previous.length) },
    (_, i) => [current[i], previous[i]],
  );
}

export function chartTable({ rows, unit, group, percent, label }) {
  if (unit)
    return {
      heads: [
        "Day of period",
        "Current date (UTC)",
        "Current " + unit.toLowerCase(),
        ...(label
          ? [label + " date (UTC)", label + " " + unit.toLowerCase()]
          : []),
      ],
      rows: rows.map(([a, b], i) => [
        i + 1,
        a?.date,
        a?.value,
        ...(label ? [b?.date, b?.value] : []),
      ]),
    };
  const suffix = percent ? " rate" : " awards";
  const cell = (n) => (n == null ? "" : format(n) + (percent ? "%" : ""));
  return {
    heads: [
      ...(percent ? ["Program", "Direction"] : [group]),
      "Current" + suffix,
      ...(label ? [label + suffix] : []),
    ],
    rows: rows.map((r) => [
      ...r.slice(0, -2),
      cell(r.at(-2)),
      ...(label ? [cell(r.at(-1))] : []),
    ]),
  };
}

export function plotDomain(charts) {
  let min = Infinity,
    max = -Infinity;
  for (const chart of charts) {
    for (const row of chart.rows) {
      const values = chart.unit ? row.map((p) => p?.value) : row.slice(-2);
      for (const n of values)
        if (Number.isFinite(n)) {
          min = Math.min(min, n);
          max = Math.max(max, n);
        }
    }
  }
  if (!Number.isFinite(min)) return [0, 1];
  if (!charts[0].balance)
    return [0, charts[0].percent ? 100 : Math.max(1, max)];
  const step = Math.max(
    1,
    10 ** Math.floor(Math.log10(Math.max(max - min, Math.abs(min) * 0.005, 1))),
  );
  const low = Math.floor(min / step) * step;
  return [low, Math.max(low + step, Math.ceil(max / step) * step)];
}

function LineComparison(props) {
  const { title, unit, rows, preview, label, domain } = props;
  const { output } = useView();
  const [selection, setSelection] = useState(null);
  const { ref, width, height } = usePlotSize();
  if (output)
    return (
      <Panel title={title}>
        <GridTable fixed {...chartTable(props)} />
      </Panel>
    );
  const [low, high] = domain ?? plotDomain([props]);
  const ticks =
    high - low <= 4
      ? Array.from({ length: high - low + 1 }, (_, i) => low + i)
      : [low, Math.round((low + high) / 2), high];
  const left = 8 + Math.max(...ticks.map((n) => format(n).length)) * 7;
  const right = width - 8;
  const bottom = height - 26;
  const span = Math.max(1, right - left);
  const x = (i) =>
    left + span * (rows.length === 1 ? 0.5 : i / (rows.length - 1));
  const y = (n) => bottom - ((n - low) * (bottom - 12)) / (high - low);
  const active = Math.min(selection ?? 0, rows.length - 1);
  const pair = rows[active];
  const paths = (label ? [0, 1] : [0]).map((series) =>
    rows
      .flatMap((row, i) => {
        if (row[series]?.value == null) return [];
        const start = !i || rows[i - 1][series]?.value == null;
        return [(start ? "M" : "L") + x(i) + " " + y(row[series].value)];
      })
      .join(" "),
  );
  return (
    <Panel title={title} caption={props.caption ?? unit + " by day of period"}>
      <div className="period-lines">
        <div className="period-legend">
          {(label ? ["Current", label] : ["Current"]).map((name, i) => (
            <span key={name}>
              <i className={i ? "before" : ""} />
              {name}
            </span>
          ))}
        </div>
        <svg
          ref={ref}
          className="report-plot"
          role="img"
          aria-label={
            title +
            (label
              ? ". Current period solid, " +
                label.toLowerCase() +
                " period dashed. "
              : ". ") +
            rows.length +
            " days."
          }
          onPointerMove={(e) => {
            const svgPoint = new DOMPoint(e.clientX, e.clientY).matrixTransform(
              e.currentTarget.getScreenCTM().inverse(),
            );
            const pos = (svgPoint.x - left) / span;
            setSelection(
              Math.max(
                0,
                Math.min(rows.length - 1, Math.round(pos * (rows.length - 1))),
              ),
            );
          }}
        >
          {ticks.map((n) => (
            <g key={n}>
              <text x={left - 6} y={y(n) + 4} textAnchor="end">
                {format(n)}
              </text>
              <path className="period-grid" d={`M${left} ${y(n)}H${right}`} />
            </g>
          ))}
          {paths.map((path, i) => (
            <path
              key={i}
              className={i ? "period-prior-line" : "period-current-line"}
              d={path}
            />
          ))}
          <path className="period-cursor" d={`M${x(active)} 8V${bottom}`} />
          {pair.map((p, i) =>
            p?.value == null ? null : (
              <circle
                key={i}
                cx={x(active)}
                cy={y(p.value)}
                r={i ? 2.8 : 4.3}
                className={i ? "period-prior-dot" : "period-current-dot"}
              />
            ),
          )}
          {Array.from(
            new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1]),
          ).map((i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 5}
              textAnchor={
                rows.length === 1
                  ? "middle"
                  : i === rows.length - 1
                    ? "end"
                    : i === 0
                      ? "start"
                      : "middle"
              }
            >
              Day {i + 1}
            </text>
          ))}
        </svg>
        <div className="period-reading" aria-live={preview ? "off" : "polite"}>
          {pair.slice(0, label ? 2 : 1).map((point, i) => (
            <span key={i}>
              <span>
                {i ? label : "Current"}
                {point && " · " + shortDate(point.date)}
              </span>
              <b>{format(point?.value)}</b>
            </span>
          ))}
        </div>
        {!preview && rows.length > 1 && (
          <input
            type="range"
            min={1}
            max={rows.length}
            value={active + 1}
            aria-label={"Inspect day of period for " + title}
            aria-valuetext={"Day " + (active + 1)}
            onChange={(e) => setSelection(Number(e.target.value) - 1)}
          />
        )}
      </div>
    </Panel>
  );
}

function CategoryComparison(props) {
  const { title, group, rows, percent, label, domain } = props;
  const { output } = useView();
  const value = (n) => (n == null ? "—" : format(n) + (percent ? "%" : ""));
  const [, max] = domain ?? plotDomain([props]);
  return (
    <Panel
      title={title}
      caption={
        props.caption ??
        (percent
          ? "Share of eligible employees participating in each program"
          : "Current status of awards eligible during each period")
      }
    >
      {output ? (
        <GridTable fixed {...chartTable(props)} />
      ) : (
        <div
          className={
            label ? "period-categories" : "period-categories single-period"
          }
        >
          <div className="period-category-head">
            <span>{group}</span>
            <span>Current</span>
            {label && <span>{label}</span>}
          </div>
          {rows.map((r) => {
            const [current, previous] = r.slice(-2);
            const name = r.slice(0, -2).join(" · ");
            return (
              <div key={name} className="period-category-row">
                <span>{name}</span>
                <b>{value(current)}</b>
                {label && <b>{value(previous)}</b>}
                <div className="period-track" aria-hidden="true">
                  {current != null && (
                    <i style={{ width: (current / max) * 100 + "%" }} />
                  )}
                  {previous != null && (
                    <em style={{ left: (previous / max) * 100 + "%" }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export function periodChartData({
  tab,
  data,
  filters,
  current,
  previous,
  readings,
  prior,
}) {
  const title = chartTitles[tab];
  if (tab === "participation") {
    const scope = orgScope(filters.org, data.orgs);
    const rows = [];
    for (const [program, name] of Object.entries(data.programs)) {
      if (filters.program && filters.program !== program) continue;
      for (const direction of ["send", "receive"]) {
        const rate = (range, period) => {
          if (!period) return null;
          const { active, total } = measure(
            data,
            period.participants,
            range.start,
            range.end,
            scope,
            program,
            direction,
          );
          return total ? (100 * active) / total : null;
        };
        rows.push([
          name,
          direction === "send" ? "Sending" : "Receiving",
          rate(current, readings),
          rate(previous, prior),
        ]);
      }
    }
    return {
      label: previous?.label,
      title,
      group: "Program",
      rows,
      percent: true,
    };
  }
  if (tab === "awards") {
    const rows = ["Upcoming", "Outstanding", "Redeemed", "Expired"].map(
      (name) => {
        const count = (period) =>
          period?.awardRows.filter(
            (r) => r.entitlement_state === name.toLowerCase(),
          ).length;
        return [name, count(readings), count(prior)];
      },
    );
    return { label: previous?.label, title, group: "Status", rows };
  }
  const a = dailyValues(tab, current, readings),
    b = previous ? dailyValues(tab, previous, prior) : [];
  const rows = alignPeriodDays(a, b);
  return {
    title,
    unit: units[tab],
    label: previous?.label,
    balance: tab === "wallets",
    rows,
  };
}

export function PeriodPlot(props) {
  return props.unit ? (
    <LineComparison {...props} />
  ) : (
    <CategoryComparison {...props} />
  );
}

export function PeriodChart(props) {
  return <PeriodPlot {...periodChartData(props)} preview={props.preview} />;
}
