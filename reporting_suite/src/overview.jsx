import {
  ArrowUpRight,
  Activity,
  Award,
  Package,
  Users,
  Wallet,
  Coins,
  Landmark,
  LogIn,
} from "lucide-react";
import { loginMeasures } from "./login-metrics";
import { TeamBreakdown } from "./team-report";
import { SummaryControls, summaryPeriod } from "./summary-controls";
import { OrganizationBreakdown } from "./organization-breakdown";
import { BankBalanceTrends } from "./bank-balance-trends";
import { Card } from "@/components/ui/card";
import {
  PeriodChart,
  PeriodPlot,
  chartTitles,
  chartTable,
  plotDomain,
  periodChartData,
} from "./period-charts";
import {
  attributeKeys,
  attributeLabel,
  assignmentScope,
  withAttribute,
} from "./employee-attributes";
import { Filter, Metrics, GridTable, Panel } from "./shared";
import { Timeline } from "./recognition";
import { BalanceTrend, Comparison, Distribution } from "./charts";
import { fmt, rate } from "./report-tools";
import { measure, rollingDays, shortDate } from "./metrics";
import { defaults, orgScope, useView } from "./view-state";
import {
  ComparisonDatePrompt,
  ComparisonDates,
  ComparisonTable,
  metricValue,
  metricChange,
  periodReadings,
} from "./period-comparison";

const icons = {
  logins: LogIn,
  funding: Landmark,
  activity: Activity,
  participation: Users,
  orders: Package,
  wallets: Wallet,
  awards: Award,
};

function ChartLink({ report, group, onOpen, children }) {
  return (
    <div className="overview-chart" onClick={onOpen}>
      {children}
      <button
        type="button"
        aria-label={
          "Open " + report + " report" + (group ? " for " + group : "")
        }
        title={"Open " + report + " report" + (group ? " for " + group : "")}
      >
        <span>
          <ArrowUpRight size={15} />
        </span>
      </button>
    </div>
  );
}

const mainMetric = {
  logins: "Successful logins",
  funding: "Award spending",
  activity: "Approved recognitions",
  participation: "Receiving participation",
  orders: "Orders placed",
  awards: "Milestone awards",
  wallets: "Points balance",
};

function BreakdownChart({
  tab,
  report,
  filters,
  current,
  previous,
  asOf,
  open,
  names,
}) {
  const { output } = useView();
  const key = filters.breakdown;
  const dimension = attributeLabel(key);
  const orgs = orgScope(filters.org, report.orgs);
  const periods = [current, previous].filter(
    (r) => r && r.start >= "2026-01-01",
  );
  // Wallet populations use the closing date. Other sources use assignments
  // during each window, with future milestones scoped at the snapshot date.
  const visible = report.history.filter(
    (h) =>
      (!orgs || orgs.has(h.org_id)) &&
      periods.some((range) => {
        const end = range.end > asOf ? asOf : range.end;
        const start =
          tab === "wallets" || range.start > end ? end : range.start;
        return h.valid_from <= end && (!h.valid_to || h.valid_to > start);
      }),
  );
  const values = Array.from(
    new Set(visible.map((h) => h.attributes[key] || null)),
  ).sort((a, b) => (a == null ? 1 : b == null ? -1 : a.localeCompare(b)));
  const groups = values.map((value) => {
    const settings = withAttribute(filters, key, value);
    const scoped = assignmentScope(report, settings);
    const read = (range) =>
      periodReadings({ [tab]: scoped }, range, settings, asOf);
    const readings = read(current);
    const prior =
      previous && previous.start >= "2026-01-01" ? read(previous) : null;
    const model = periodChartData({
      tab,
      data: scoped,
      filters: settings,
      current,
      previous,
      readings,
      prior,
    });
    const metric = readings.metrics.find((m) => m.label === mainMetric[tab]);
    const reference = prior?.metrics.find((m) => m.label === mainMetric[tab]);
    return {
      value,
      name: value ?? "Unassigned",
      model,
      amount: metricValue(report, metric),
      reference: reference ? metricValue(report, reference) : "—",
    };
  });
  const title = chartTitles[tab] + " · " + dimension;
  if (output) {
    const tables = groups.map((g) => chartTable(g.model));
    return (
      <section>
        <h2>{title} · Summary</h2>
        <GridTable
          fixed
          heads={[
            dimension,
            "Metric",
            "Current",
            ...(previous ? [previous.label] : []),
          ]}
          rows={groups.map((g) => [
            g.name,
            mainMetric[tab],
            g.amount,
            ...(previous ? [g.reference] : []),
          ])}
        />
        <h2>{title}</h2>
        <GridTable
          fixed
          heads={[dimension, ...(tables[0]?.heads ?? [])]}
          rows={groups.flatMap((g, i) =>
            tables[i].rows.map((row) => [g.name, ...row]),
          )}
        />
      </section>
    );
  }
  const domain = plotDomain(groups.map((g) => g.model));
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {!groups.length && (
        <p className="text-sm text-muted-foreground">
          No matching employee assignments.
        </p>
      )}
      <div className="breakdown-plots">
        {groups.map((g) => (
          <ChartLink
            key={JSON.stringify(g.value)}
            report={names[tab][0]}
            group={g.name}
            onOpen={() => open(tab, { group: g.value })}
          >
            <PeriodPlot
              {...g.model}
              title={g.name}
              domain={domain}
              preview
              caption={
                mainMetric[tab] +
                " · " +
                g.amount +
                (previous
                  ? " current / " +
                    g.reference +
                    " " +
                    previous.label.toLowerCase()
                  : "")
              }
            />
          </ChartLink>
        ))}
      </div>
    </section>
  );
}

function BudgetOverview({ banks, previous, prior, openBank }) {
  const { output } = useView();
  const labels = ["Remaining points", "Award spending (points)", "Utilization"];
  const values = (b) =>
    b
      ? [fmt(b.remaining), fmt(b.scopedSpend), rate(b.spent, b.available)]
      : labels.map(() => "—");
  const heads = [
    "Funding bank",
    ...labels.flatMap((label) =>
      output && previous
        ? [label, previous.label + " " + label.toLowerCase()]
        : [label],
    ),
  ];
  const rows = banks.map((bank) => {
    const current = values(bank);
    const before = values(prior?.find((b) => b.bank_id === bank.bank_id));
    const name = output ? (
      bank.name
    ) : (
      <button
        className="inline-flex items-center gap-1 text-left font-medium hover:underline"
        onClick={() => openBank(bank.bank_id)}
        aria-label={"Open funding budget for " + bank.name}
      >
        {bank.name}
        <ArrowUpRight size={13} />
      </button>
    );
    return [
      name,
      ...current.flatMap((value, i) => {
        if (output) return previous ? [value, before[i]] : [value];
        return [
          <div className="grid gap-1 tabular-nums">
            <strong className="font-semibold">{value}</strong>
            {i === 2 && bank.available > 0 && (
              <div
                className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-[var(--secondary-ink)]"
                  style={{
                    width:
                      Math.max(
                        0,
                        Math.min(100, (100 * bank.spent) / bank.available),
                      ) + "%",
                  }}
                />
              </div>
            )}
            {previous && (
              <small className="text-muted-foreground">
                {previous.label} {before[i]}
              </small>
            )}
          </div>,
        ];
      }),
    ];
  });
  return (
    <Panel
      title="Funding budgets"
      caption="Remaining points and utilization cover each whole bank. Award spending follows the selected sender filters."
    >
      <GridTable
        fixed
        heads={heads}
        rows={rows}
        empty="No funding banks for this customer."
      />
    </Panel>
  );
}

export function Overview({
  data,
  source,
  asOf,
  filters,
  setFilters,
  openReport,
  openTeam,
  renderFilters = (controls) => controls,
  names,
}) {
  const { output } = useView();
  const { activity, participation, orders, wallets, awards } = data.reports;
  const { current, valid, previous } = summaryPeriod(filters, asOf);
  const { start, end } = current;
  const change = (key, value) =>
    setFilters((old) => ({ ...old, [key]: value }));
  const scope = (report) => orgScope(filters.org, report.orgs);
  const breakdownKeys = attributeKeys(Object.values(data.reports)).filter(
    (key) =>
      Object.values(data.reports).every((report) =>
        report.attribute_keys.includes(key),
      ),
  );
  function open(tab, { group, bank, metric, org = filters.org } = {}) {
    const { breakdown, ...reportFilters } = filters;
    const selection =
      group === undefined
        ? reportFilters
        : withAttribute(reportFilters, breakdown, group);
    openReport(
      tab,
      {
        ...defaults,
        ...selection,
        org,
        ...(tab === "awards" ? { eligibilityPeriod: filters.period } : {}),
      },
      ["orders", "wallets", "funding"].includes(tab)
        ? {
            ...(rollingDays[filters.period]
              ? { dateMode: filters.period }
              : { start, end }),
            org,
            ...(bank ? { bank } : {}),
          }
        : tab === "logins" && metric === "Users without a login"
          ? { loginDetail: "withoutLogin" }
          : {},
    );
  }
  const read = (range) => periodReadings(data.reports, range, filters, asOf);
  const readings = valid ? read(current) : null;
  const prior =
    previous && previous.start >= "2026-01-01" ? read(previous) : null;
  const tileLabels = [
    activity ? "Approved recognitions" : "Points balance",
    "Receiving participation",
    ...(!activity ? ["Orders placed"] : []),
    orders
      ? orders.viewer.can_view_order_value
        ? "Order value"
        : "Item units"
      : "Points awarded",
    "Milestone awards",
    "Remaining budget",
    ...loginMeasures.map(([, label]) => label),
  ];
  const selectTiles = (period) =>
    tileLabels
      .map((label) => period.metrics.find((m) => m.label === label))
      .filter(Boolean);
  const tiles = readings ? selectTiles(readings) : [];
  const chart = (tab, content) =>
    output ? (
      content
    ) : (
      <ChartLink key={tab} report={names[tab][0]} onOpen={() => open(tab)}>
        {content}
      </ChartLink>
    );
  const plots = (
    { start, end },
    { events, participants, tx, orderRows, awardRows },
  ) => (
    <div className="overview-plots">
      {activity &&
        chart(
          "activity",
          <Timeline
            events={events}
            start={start}
            end={end > asOf ? asOf : end}
            title="Recognition over time"
          />,
        )}
      {participation &&
        chart(
          "participation",
          <Comparison
            title="Participation by program"
            caption="Share of eligible employees during the selected period"
            max={100}
            series={["Sending", "Receiving"]}
            format={(n) =>
              n == null
                ? "—"
                : n.toLocaleString("en-US", {
                    maximumFractionDigits: 1,
                  }) + "%"
            }
            rows={Object.entries(participation.programs).map(([id, name]) => [
              name,
              ...["send", "receive"].map((direction) => {
                const m = measure(
                  participation,
                  participants,
                  start,
                  end,
                  scope(participation),
                  id,
                  direction,
                );
                return m.total ? (100 * m.active) / m.total : null;
              }),
            ])}
          />,
        )}
      {wallets &&
        chart(
          "wallets",
          <BalanceTrend
            title="Points balance over time"
            caption="Closing points balance through the selected end date"
            transactions={tx}
            from={start}
            through={end > asOf ? asOf : end}
            preview
          />,
        )}
      {orders &&
        chart(
          "orders",
          <Timeline
            title="Orders over time"
            unit="Orders submitted"
            color="var(--secondary-ink)"
            events={orderRows.map((o) => ({ at: o.submitted_at }))}
            start={start}
            end={end > asOf ? asOf : end}
          />,
        )}
      {["funding", "logins"]
        .filter((tab) => data.reports[tab])
        .map((tab) =>
          chart(
            tab,
            <PeriodChart
              key={tab}
              tab={tab}
              current={current}
              readings={readings}
              preview
            />,
          ),
        )}
      {awards &&
        chart(
          "awards",
          <Distribution
            title="Milestone awards by status"
            caption="Current status of awards reaching eligibility during the period"
            unit="Awards"
            rows={["upcoming", "outstanding", "redeemed", "expired"].map(
              (s) => [
                s[0].toUpperCase() + s.slice(1),
                awardRows.filter((r) => r.entitlement_state === s).length,
              ],
            )}
          />,
        )}
    </div>
  );
  return (
    <>
      {renderFilters(
        <SummaryControls {...{ data, filters, asOf, setFilters }}>
          {breakdownKeys.length > 0 && (
            <Filter
              label="Break down by"
              value={filters.breakdown || ""}
              options={[
                ["", "No breakdown"],
                ...breakdownKeys.map((k) => [k, attributeLabel(k)]),
              ]}
              onChange={(v) => change("breakdown", v)}
            />
          )}
        </SummaryControls>,
      )}
      {!valid ? (
        <p role="alert">
          Choose a valid reporting period between January 1, 2026 and {asOf}.
        </p>
      ) : filters.compare === "custom" && !previous ? (
        <ComparisonDatePrompt asOf={asOf} />
      ) : (
        <>
          {previous && (
            <ComparisonDates current={current} previous={previous} />
          )}
          {output ? (
            previous ? (
              <ComparisonTable
                data={data}
                label={previous.label}
                metrics={tiles}
                previous={prior && selectTiles(prior)}
              />
            ) : (
              <Metrics
                items={tiles.map((m) => [
                  m.label,
                  metricValue(data, m),
                  m.hint,
                ])}
              />
            )
          ) : (
            <div className="overview-metrics">
              {tiles.map((metric) => {
                const { tab, label, hint } = metric;
                const Icon =
                  label === "Order value" || label === "Points awarded"
                    ? Coins
                    : icons[tab];
                const value = metricValue(data, metric);
                const last = prior?.metrics.find((m) => m.label === label);
                return (
                  <Card key={label} className="overview-metric">
                    <button
                      onClick={() => open(tab, { metric: label })}
                      aria-label={
                        label +
                        ", " +
                        value +
                        (last
                          ? ", " +
                            previous.label.toLowerCase() +
                            " " +
                            metricValue(data, last) +
                            ", change " +
                            metricChange(data, metric, last)
                          : "") +
                        ". Open " +
                        names[tab][0] +
                        " report"
                      }
                    >
                      <span className="overview-metric-label">
                        <Icon size={15} />
                        {label}
                      </span>
                      <strong>{value}</strong>
                      {last && (
                        <span className="flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
                          <b className="rounded bg-muted px-1.5 py-0.5">
                            {metricChange(data, metric, last)}
                          </b>
                          <span>from {metricValue(data, last)}</span>
                        </span>
                      )}
                      <small>{hint}</small>
                    </button>
                  </Card>
                );
              })}
            </div>
          )}
          <OrganizationBreakdown
            {...{ data, filters, current, previous, asOf }}
            choose={(org) => change("org", org)}
            openReport={(tab, org) => open(tab, { org })}
          />
          <TeamBreakdown
            navigate={openTeam}
            {...{ source, filters, current, previous, asOf }}
          />
          {readings.banks && (
            <>
              <BudgetOverview
                banks={readings.banks}
                prior={prior?.banks}
                previous={previous}
                openBank={(bank) => open("funding", { bank })}
              />
              <BankBalanceTrends
                {...{ current, previous, asOf }}
                banks={readings.banks}
                priorBanks={prior?.banks}
                renderChart={(bank, chart) => (
                  <ChartLink
                    report={names.funding[0]}
                    group={bank.name}
                    onOpen={() => open("funding", { bank: bank.bank_id })}
                  >
                    {chart}
                  </ChartLink>
                )}
              />
            </>
          )}
          {filters.breakdown ? (
            <div className="space-y-5">
              {breakdownKeys.includes(filters.breakdown) ? (
                Object.entries(data.reports).map(([tab, report]) => (
                  <BreakdownChart
                    key={tab}
                    {...{
                      tab,
                      report,
                      filters,
                      current,
                      previous,
                      asOf,
                      open,
                      names,
                    }}
                  />
                ))
              ) : (
                <p role="alert">
                  This breakdown is unavailable for the selected role.
                </p>
              )}
            </div>
          ) : previous ? (
            <div className="overview-plots">
              {[
                "activity",
                "participation",
                "wallets",
                "orders",
                "awards",
                "funding",
                "logins",
              ]
                .filter((tab) => data.reports[tab])
                .map((tab) => {
                  const plot = (
                    <PeriodChart
                      key={tab}
                      tab={tab}
                      data={data.reports[tab]}
                      {...{ current, previous, readings, prior, filters }}
                      preview
                    />
                  );
                  return chart(tab, plot);
                })}
            </div>
          ) : (
            plots(current, readings)
          )}
          <footer className="text-xs text-muted-foreground">
            Data as of {shortDate(asOf)}, {asOf.slice(0, 4)} · UTC
          </footer>
        </>
      )}
    </>
  );
}
