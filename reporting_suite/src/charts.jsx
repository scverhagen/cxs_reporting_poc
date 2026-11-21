import { useId, useState } from "react";
import { GridTable, Panel } from "./shared";
import { useView } from "./view-state";

const colors = [
  "#356ad1",
  "#158273",
  "#8462ad",
  "#cd7738",
  "#6a8eac",
  "#b25173",
  "#758093",
];
const number = (n) =>
  n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const dateLabel = (date) =>
  new Date(
    date + (date.length === 7 ? "-01" : "") + "T00:00:00Z",
  ).toLocaleDateString("en-US", {
    month: "short",
    ...(date.length === 7 ? { year: "numeric" } : { day: "numeric" }),
    timeZone: "UTC",
  });
const empty = (
  <p className="py-3 text-sm text-muted-foreground">
    No matching data for this selection.
  </p>
);

export function Comparison({
  title,
  caption,
  series,
  rows,
  format = number,
  onSelect,
  max,
}) {
  const { output } = useView();
  const limit =
    max ||
    Math.max(1, ...rows.flatMap((r) => r.slice(1)).filter(Number.isFinite));
  return (
    <Panel title={title} caption={caption}>
      {output ? (
        <GridTable
          fixed
          heads={["Group", ...series]}
          rows={rows.map(([name, ...values]) => [name, ...values.map(format)])}
        />
      ) : !rows.length ? (
        empty
      ) : (
        <div>
          {series.length > 1 && (
            <div className="plot-key">
              {series.map((s, i) => (
                <span key={s}>
                  <i style={{ background: colors[i] }} />
                  {s}
                </span>
              ))}
            </div>
          )}
          <div className="comparison-rows">
            {rows.map(([name, ...values]) => (
              <div className="comparison-row" key={name}>
                <strong>
                  {onSelect ? (
                    <button
                      className="text-left hover:underline"
                      onClick={() => onSelect(name)}
                    >
                      {name}
                    </button>
                  ) : (
                    name
                  )}
                </strong>
                <div>
                  {values.map((n, i) => (
                    <div
                      key={series[i]}
                      className="comparison-series"
                      aria-label={name + ", " + series[i] + ", " + format(n)}
                    >
                      <div className="comparison-track">
                        <i
                          style={{
                            width: (100 * (n || 0)) / limit + "%",
                            background: colors[i],
                          }}
                        />
                      </div>
                      <span>{format(n)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

export function Distribution({
  title,
  caption,
  rows,
  unit = "Count",
  onSelect,
}) {
  const { output } = useView();
  const total = rows.reduce((a, r) => a + r[1], 0);
  return (
    <Panel title={title} caption={caption}>
      {output ? (
        <GridTable
          fixed
          heads={["Group", unit]}
          rows={rows.map(([name, n]) => [name, n])}
        />
      ) : !total ? (
        empty
      ) : (
        <>
          <div aria-hidden="true" className="distribution-strip">
            {rows.map(
              ([name, n], i) =>
                n > 0 && (
                  <i
                    key={name}
                    style={{ flex: n, background: colors[i % colors.length] }}
                  />
                ),
            )}
          </div>
          <div className="distribution-key">
            {rows.map(([name, n, key], i) => {
              const content = (
                <>
                  <i style={{ background: colors[i % colors.length] }} />
                  <span>{name}</span>
                  <b>{number(n)}</b>
                  <small>{number(Math.round((n * 100) / total))}%</small>
                </>
              );
              return onSelect ? (
                <button
                  type="button"
                  key={name}
                  onClick={() => onSelect(key)}
                  aria-label={`Filter by ${name}, ${n} ${unit.toLowerCase()}`}
                >
                  {content}
                </button>
              ) : (
                <div key={name}>{content}</div>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}

// Carry the opening balance into the first bucket, including idle days or months.
export function BalanceTrend({
  title,
  caption,
  transactions,
  from,
  through,
  preview = false,
}) {
  const { output } = useView();
  const [selection, setSelection] = useState(null);
  const gradient = useId();
  const daily = (Date.parse(through) - Date.parse(from)) / 86400000 < 45;
  const bucket = (date) => date.slice(0, daily ? 10 : 7);
  const deltas = new Map();
  let balance = 0;
  for (const t of transactions) {
    const date = t.occurred_at.slice(0, 10);
    if (date < from) balance += t.points_delta;
    else if (date <= through)
      deltas.set(
        bucket(date),
        (deltas.get(bucket(date)) || 0) + t.points_delta,
      );
  }
  const rows = [];
  if (transactions.length) {
    const cursor = new Date(
      (daily ? from : from.slice(0, 7) + "-01") + "T00:00:00Z",
    );
    while (cursor.toISOString().slice(0, 10) <= through) {
      const key = bucket(cursor.toISOString());
      balance += deltas.get(key) || 0;
      rows.push([key, balance]);
      if (daily) cursor.setUTCDate(cursor.getUTCDate() + 1);
      else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const selected = rows.findIndex(([m]) => m === selection);
  const index = selected < 0 ? rows.length - 1 : selected;
  const values = rows.map((r) => r[1]);
  const low = rows.length ? Math.min(...values) : 0,
    high = rows.length ? Math.max(...values) : 0;
  const step =
    10 **
    Math.floor(Math.log10(Math.max(high - low, Math.abs(high) * 0.015, 1)));
  const min = Math.min(low, Math.floor((low - step * 0.1) / step) * step);
  const lower = low >= 0 ? Math.max(0, min) : min;
  const max = Math.max(
    lower + step,
    Math.ceil((high + step * 0.1) / step) * step,
  );
  const x = (i) =>
    rows.length === 1 ? 300 : 8 + (i * 584) / (rows.length - 1);
  const y = (n) => 105 - ((n - lower) * 97) / (max - lower);
  const line = rows
    .map(([, n], i) => (i ? "L" : "M") + x(i) + " " + y(n))
    .join(" ");
  return (
    <Panel title={title} caption={caption}>
      {output ? (
        <GridTable
          fixed
          heads={[daily ? "Date" : "Month", "Closing points balance"]}
          rows={rows}
        />
      ) : !rows.length ? (
        empty
      ) : (
        <div className="balance-trend">
          <div className="balance-reading" aria-live="polite">
            <span>{dateLabel(rows[index][0])}</span>
            <b>{number(rows[index][1])} points</b>
          </div>
          <div className="balance-plot">
            <div aria-hidden="true" className="balance-scale">
              <span>{number(max)}</span>
              <span>{number((max + lower) / 2)}</span>
              <span>{number(lower)}</span>
            </div>
            <svg
              viewBox="0 0 600 112"
              preserveAspectRatio="none"
              role="img"
              aria-label={
                title +
                " from " +
                dateLabel(rows[0][0]) +
                " to " +
                dateLabel(rows.at(-1)[0])
              }
            >
              <defs>
                <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                  <stop stopColor="#4e88db" stopOpacity=".28" />
                  <stop offset="1" stopColor="#4e88db" stopOpacity=".03" />
                </linearGradient>
              </defs>
              {[8, 56, 105].map((v) => (
                <path
                  key={v}
                  d={`M0 ${v}H600`}
                  stroke="#e2e7ed"
                  strokeDasharray="4 4"
                />
              ))}
              <path
                d={line + ` L${x(rows.length - 1)} 105 L${x(0)} 105 Z`}
                fill={`url(#${gradient})`}
              />
              <path
                d={line}
                fill="none"
                stroke={colors[0]}
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={`M${x(index)} 5 V105`}
                stroke="#929eac"
                strokeDasharray="3 3"
              />
              {rows.map(([m, n], i) => (
                <circle
                  key={m}
                  cx={x(i)}
                  cy={y(n)}
                  r={i === index ? 4.5 : 3}
                  stroke="white"
                  fill={colors[0]}
                />
              ))}
            </svg>
          </div>
          {!preview && (
            <input
              type="range"
              aria-label={
                daily ? "Inspect daily balance" : "Inspect monthly balance"
              }
              aria-valuetext={
                dateLabel(rows[index][0]) +
                ", " +
                number(rows[index][1]) +
                " points"
              }
              min={0}
              max={rows.length - 1}
              value={index}
              disabled={rows.length === 1}
              onChange={(e) => setSelection(rows[Number(e.target.value)][0])}
            />
          )}
          <div className="balance-axis">
            <span>{dateLabel(rows[0][0])}</span>
            {rows.length > 1 && <span>{dateLabel(rows.at(-1)[0])}</span>}
          </div>
        </div>
      )}
    </Panel>
  );
}
