import { useId } from "react";
import { usePlotSize } from "./use-plot-size";
import { EmployeeDrillLink } from "./hierarchy";
import { ReportPlot } from "./period-charts";
import { Comparison, Distribution } from "./charts";
import { useView } from "./view-state";
import { Panel, Metrics, GridTable } from "./shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  day,
  dayMs,
  iso,
  milestoneDate,
  upcomingIn,
  milestoneRows,
  awardSeries,
  tally,
} from "./metrics";
export const types = (s) =>
  s[0].toUpperCase() + s.slice(1).replaceAll("_", " ");
export const ages = ["0-29", "30-59", "60-89", "90+"];
function AwardTrend({ rows, asOf }) {
  const { ref, width, height } = usePlotSize();
  const gradient = useId();
  const { months, series } = awardSeries(rows, asOf);
  const top = Math.max(2, Math.ceil(Math.max(...series.flat()) / 2) * 2);
  const left = Math.max(18, 8 + String(top).length * 7);
  const right = width - 14;
  const bottom = height - 25;
  const x = (i) => left + ((right - left) * i) / (months.length - 1);
  const y = (n) => bottom - ((bottom - 12) * n) / top;
  return (
    <>
      <div className="trend-legend">
        <span>Newly eligible</span>
        <span>Redeemed</span>
      </div>
      <svg
        ref={ref}
        className="report-plot"
        role="img"
        aria-label={`Monthly newly eligible awards: ${series[0].join(", ")}. Monthly redemptions: ${series[1].join(", ")}.`}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="var(--primary)" stopOpacity=".18" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity=".02" />
          </linearGradient>
        </defs>
        {[0, top / 2, top].map((n) => (
          <g key={n}>
            <path d={`M${left} ${y(n)}H${right}`} stroke="var(--border)" />
            <text x={left - 6} y={y(n) + 4} textAnchor="end">
              {n}
            </text>
          </g>
        ))}
        {series.map((values, j) => {
          const d = values
            .map((n, i) => `${i ? "L" : "M"}${x(i)} ${y(n)}`)
            .join(" ");
          const color = j ? "var(--secondary-ink)" : "var(--primary)";
          return (
            <g key={j}>
              {j === 0 && (
                <path
                  d={`${d} V${bottom} H${left} Z`}
                  fill={`url(#${gradient})`}
                />
              )}
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              {values.map((n, i) => (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(n)}
                  r="3"
                  fill="var(--card)"
                  stroke={color}
                  strokeWidth="2"
                >
                  <title>
                    {iso(months[i]).slice(0, 7)} · {j ? "Redeemed" : "Eligible"}
                    : {n}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
        {months.map((month, i) => (
          <text key={i} x={x(i)} y={height - 5} textAnchor="middle">
            {month.toLocaleDateString("en-US", {
              month: "short",
              timeZone: "UTC",
            })}
          </text>
        ))}
      </svg>
    </>
  );
}
function Overview({ rows, data, asOf, drill }) {
  const { output } = useView();
  const outstanding = rows.filter((r) => r.entitlement_state === "outstanding");
  const states = ["upcoming", "outstanding", "redeemed", "expired"].map(
    (state) => rows.filter((r) => r.entitlement_state === state).length,
  );
  const eligible = rows.length - states[0];
  const colors = ["var(--primary)", "var(--secondary-ink)", "#b97e3f", "var(--muted-ink)"];
  let stop = 0;
  const slices = states.map((n, i) => {
    const start = stop;
    stop += (360 * n) / (rows.length || 1);
    return colors[i] + " " + start + "deg " + stop + "deg";
  });
  const attention = outstanding.flatMap((r) => {
    const issues = [];
    if (r.notification_status === "failed") issues.push("Notification failed");
    if (r.expires_on && r.expires_on <= iso(new Date(+day(asOf) + 30 * dayMs)))
      issues.push("Expires within 30 days");
    return issues.map((reason) => [
      <Badge variant="outline">{reason}</Badge>,
      <EmployeeDrillLink
        data={data}
        id={r.employee_id}
        date={r.eligible_on < asOf ? r.eligible_on : asOf}
      />,
      types(r.milestone_type),
      milestoneDate(r.eligible_on),
      milestoneDate(r.expires_on),
    ]);
  });
  return (
    <>
      <Metrics
        items={[
          ["Total awards", rows.length, "All milestone entitlements"],
          ["Outstanding", states[1], "Awaiting redemption"],
          ["Redeemed", states[2], "Completed redemptions"],
          [
            "Redemption rate",
            eligible
              ? ((100 * states[2]) / eligible).toLocaleString("en-US", {
                  maximumFractionDigits: 2,
                }) + "%"
              : "—",
            states[2] + " of " + eligible + " eligible awards",
          ],
        ]}
      />
      {output ? (
        <AwardBreakdowns {...{ rows, asOf, states, outstanding }} />
      ) : (
        <div className="report-grid">
          <Panel
            title="Award activity over time"
            caption={"Monthly awards through " + milestoneDate(asOf)}
          >
            <AwardTrend rows={rows} asOf={asOf} />
          </Panel>
          <ReportPlot>
            <Panel title="Awards by status" caption="Share of total awards">
              <div className="flex min-h-40 flex-wrap items-center gap-5">
                <figure className="grid justify-items-center gap-1.5">
                  <div
                    className="grid size-28 place-items-center rounded-full"
                    style={{
                      background: rows.length
                        ? "conic-gradient(from -90deg," + slices.join(",") + ")"
                        : "var(--muted)",
                    }}
                  >
                    <strong className="grid size-20 place-items-center rounded-full bg-card text-3xl font-semibold tabular-nums">
                      {rows.length}
                    </strong>
                  </div>
                  <figcaption className="text-xs text-muted-foreground">
                    Total awards
                  </figcaption>
                </figure>
                <dl className="min-w-28 flex-1 space-y-2 text-sm">
                  {["Upcoming", "Outstanding", "Redeemed", "Expired"].map(
                    (name, i) => (
                      <div key={name} className="flex items-center gap-2">
                        <i
                          className="size-2 rounded-sm"
                          style={{ background: colors[i] }}
                        />
                        <dt>{name}</dt>
                        <dd className="ml-auto font-semibold">{states[i]}</dd>
                      </div>
                    ),
                  )}
                </dl>
              </div>
            </Panel>
          </ReportPlot>
          <Panel
            title="Upcoming eligibility"
            caption="Select a horizon to view employees."
          >
            <div className="flex gap-2">
              {["30", "60", "90", "all"].map((h) => {
                const n = upcomingIn(rows, h, asOf).length;
                return (
                  <Button
                    key={h}
                    variant="ghost"
                    className="h-36 flex-1 flex-col justify-end gap-1 px-1"
                    onClick={() => drill("upcoming", "horizon", h)}
                  >
                    <b>{n}</b>
                    <span
                      className="w-3/5 max-w-14 rounded-t bg-primary"
                      style={{ height: (89 * n) / (states[0] || 1) }}
                    />
                    <span className="text-xs">
                      {h === "all" ? "All dates" : h + " days"}
                    </span>
                  </Button>
                );
              })}
            </div>
          </Panel>
          <Panel
            title="Outstanding by age"
            caption={
              data.tabs.includes("nonresponders")
                ? "Select an age range to view non-responders."
                : "Time since eligibility for outstanding awards."
            }
          >
            {ages.map((a) => {
              const n = outstanding.filter((r) => r.aging_bucket === a).length;
              return (
                <Button
                  key={a}
                  variant="ghost"
                  className="flex w-full justify-between px-1"
                  disabled={!data.tabs.includes("nonresponders")}
                  onClick={() => drill("nonresponders", "age", a)}
                >
                  <span className="w-20 text-left">{a} days</span>
                  <span className="h-2 flex-1 rounded bg-muted">
                    <i
                      className="block h-full rounded bg-primary"
                      style={{ width: (100 * n) / (states[1] || 1) + "%" }}
                    />
                  </span>
                  <b className="w-6">{n}</b>
                </Button>
              );
            })}
          </Panel>
        </div>
      )}
      <Panel
        title="Awards needing attention"
        caption="Notification failures and upcoming expirations"
      >
        <GridTable
          heads={[
            "Reason",
            "Employee",
            "Milestone",
            "Eligible on",
            "Expires on",
          ]}
          rows={attention}
          empty="No awards need attention in this selection."
        />
      </Panel>
    </>
  );
}
export function Milestones({ tab, data, filters, asOf, scope, drill }) {
  if (
    filters.eligibilityPeriod === "custom" &&
    (!filters.start ||
      !filters.end ||
      filters.start > filters.end ||
      filters.start < "2026-01-01" ||
      filters.end > asOf)
  )
    return <p role="alert">Choose a valid eligibility date range.</p>;
  const names = Object.fromEntries(data.orgs.map((o) => [o.org_id, o.name]));
  const rows = milestoneRows(data, filters, asOf, scope);
  if (tab === "awards") return <Overview {...{ rows, data, asOf, drill }} />;
  if (tab === "upcoming") {
    const selected = upcomingIn(rows, filters.horizon, asOf);
    return (
      <>
        <Comparison
          title="Eligibility by month"
          caption="Upcoming entitlements within the selected horizon."
          series={["Awards"]}
          rows={tally(selected.map((r) => r.eligible_on.slice(0, 7)))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([m, n]) => [
              day(m + "-01").toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              }),
              n,
            ])}
        />
        <Panel
          title={"Upcoming awards (" + selected.length + ")"}
          caption="Soonest eligibility first"
        >
          <GridTable
            heads={[
              "Employee",
              "Milestone",
              "Eligible on",
              "Days until eligible",
              "Milestone date",
              "Program",
              "Organization",
            ]}
            rows={selected.map((r) => [
              <EmployeeDrillLink
                data={data}
                id={r.employee_id}
                date={r.eligible_on < asOf ? r.eligible_on : asOf}
              />,
              types(r.milestone_type),
              milestoneDate(r.eligible_on),
              (day(r.eligible_on) - day(asOf)) / dayMs,
              milestoneDate(r.milestone_date),
              data.milestone_programs[r.program_id],
              names[r.org] || "—",
            ])}
          />
        </Panel>
      </>
    );
  }
  const selected = rows.filter(
    (r) =>
      r.entitlement_state === "outstanding" &&
      (!filters.age || filters.age === r.aging_bucket),
  );
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: data.currency,
  });
  return (
    <>
      <Distribution
        title="Outstanding awards by age"
        caption="Select an age range to filter the follow-up list."
        unit="Awards"
        rows={ages.map((a) => [
          a + " days",
          selected.filter((r) => r.aging_bucket === a).length,
          a,
        ])}
        onSelect={(a) =>
          drill("nonresponders", "age", filters.age === a ? "" : a)
        }
      />
      <Panel
        title={"Outstanding awards (" + selected.length + ")"}
        caption="Oldest eligible awards first. Failed notifications are included for follow-up."
      >
        <GridTable
          heads={[
            "Employee",
            "Milestone",
            "Eligible on",
            "Age",
            "Status",
            "Notification",
            "Expires on",
            "Award value",
            "Organization",
          ]}
          rows={selected.map((r) => [
            <EmployeeDrillLink
              data={data}
              id={r.employee_id}
              date={r.eligible_on < asOf ? r.eligible_on : asOf}
            />,
            types(r.milestone_type),
            milestoneDate(r.eligible_on),
            r.outstanding_age_days + " days",
            <Badge variant="secondary">Outstanding</Badge>,
            <Badge
              variant={
                r.notification_status === "failed" ? "destructive" : "outline"
              }
            >
              {types(r.notification_status)}
            </Badge>,
            milestoneDate(r.expires_on),
            r.award_value_minor == null
              ? "—"
              : money.format(r.award_value_minor / 100),
            names[r.org] || "—",
          ])}
        />
      </Panel>
    </>
  );
}

function AwardBreakdowns({ rows, asOf, states, outstanding }) {
  const { months, series } = awardSeries(rows, asOf);
  return (
    <>
      <Panel title="Award activity over time">
        <GridTable
          heads={["Month", "Newly eligible", "Redeemed"]}
          rows={months.map((m, i) => [
            iso(m).slice(0, 7),
            series[0][i],
            series[1][i],
          ])}
        />
      </Panel>
      <ReportPlot>
        <Panel title="Awards by status">
          <GridTable
            heads={["Status", "Awards"]}
            rows={["Upcoming", "Outstanding", "Redeemed", "Expired"].map(
              (s, i) => [s, states[i]],
            )}
          />
        </Panel>
      </ReportPlot>
      <Panel title="Upcoming eligibility">
        <GridTable
          heads={["Horizon (days)", "Awards"]}
          rows={["30", "60", "90", "all"].map((h) => [
            h,
            upcomingIn(rows, h, asOf).length,
          ])}
        />
      </Panel>
      <Panel title="Outstanding by age">
        <GridTable
          heads={["Age (days)", "Awards"]}
          rows={ages.map((a) => [
            a,
            outstanding.filter((r) => r.aging_bucket === a).length,
          ])}
        />
      </Panel>
    </>
  );
}
