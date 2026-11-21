import { Button } from "@/components/ui/button";
import { Comparison } from "./charts";
import { measure, orgAt, recognitionEvents, tally } from "./metrics";
import {
  ComparisonDates,
  ComparisonTable,
  metricChange,
  metricValue,
} from "./period-comparison";
import { PeriodChart } from "./period-charts";
import { Bars, Timeline } from "./recognition";
import { GridTable, Metrics, Panel } from "./shared";
import { orgScope, useView } from "./view-state";

const measures = [
  "Approved recognitions",
  "Sending participation",
  "Receiving reach",
  "Events / active sender",
  "Points awarded",
];

function readPeriod(data, range, scope, program) {
  if (!range || range.start < "2026-01-01") return null;
  const { start, end } = range;
  // Keep incoming recognitions available when evaluating recipients in this branch.
  const all = recognitionEvents(
    data,
    "participation",
    start,
    end,
    scope,
    program,
  );
  const events = all.filter((e) =>
    orgAt(data, e.sender, e.at.slice(0, 10), scope),
  );
  const senders = new Set(events.map((e) => e.sender));
  const participation = (direction, population) => {
    const { active, total } = measure(
      data,
      all,
      start,
      end,
      scope,
      program,
      direction,
    );
    return {
      value: total ? (100 * active) / total : null,
      unit: "rate",
      hint: active + " of " + total + " eligible " + population,
    };
  };
  const metrics = [
    { value: events.length, hint: "Distinct events by sender scope" },
    participation("send", "senders"),
    participation("receive", "recipients"),
    {
      value: senders.size ? events.length / senders.size : null,
      hint: "Approved events per distinct sender",
    },
    {
      value: events.reduce((sum, e) => sum + e.points, 0),
      hint: "Across approved recipients",
    },
  ].map((metric, i) => ({ ...metric, label: measures[i] }));
  return { events, metrics, asOf: data.observed_through };
}

function PerformanceTable({
  data,
  title,
  caption,
  heads,
  groups,
  previous,
  fixed = false,
}) {
  const { options, output } = useView();
  const columnKey = heads.join("|");
  // A hidden program measure also hides its comparison and change in the CSV.
  const hidden = output && !fixed ? options["columns:" + columnKey] || [] : [];
  const columns = heads
    .map((head, index) => ({ head, index }))
    .filter(({ head }) => !hidden.includes(head));
  const headers = columns.flatMap(({ head, index }) =>
    output && previous && index
      ? [head, previous.label + " · " + head, "Change · " + head]
      : [head],
  );

  function cells(group, index) {
    if (!index) return [group.label];
    const metric = group.now.metrics[index - 1];
    const before = group.prior?.metrics[index - 1];
    if (group.monetary === false && metric.label === "Points awarded")
      return previous && output
        ? ["Non-monetary", before ? "Non-monetary" : "—", "—"]
        : ["Non-monetary"];
    const value = metricValue(data, metric);
    const reference = before ? metricValue(data, before) : "—";
    const change = metricChange(data, metric, before);
    if (output) return previous ? [value, reference, change] : [value];
    if (!previous && metric.unit !== "rate") return [value];
    return [
      <div className="grid gap-0.5 tabular-nums">
        <strong>{value}</strong>
        {metric.unit === "rate" && (
          <small className="text-muted-foreground">{metric.hint}</small>
        )}
        {previous && (
          <small className="text-muted-foreground">
            {previous.label} {reference} · Change {change}
          </small>
        )}
      </div>,
    ];
  }
  return (
    <Panel {...{ title, caption }}>
      <GridTable
        fixed={fixed || !!output}
        heads={headers}
        columnKey={columnKey}
        empty="No matching teams or programs for these filters and dates."
        rows={groups.map((group) =>
          columns.flatMap(({ index }) => cells(group, index)),
        )}
      />
    </Panel>
  );
}

export function Performance({
  data,
  filters,
  current,
  previous,
  individual,
  branches,
  setProgram,
}) {
  const { output } = useView();
  const scope = orgScope(filters.org, data.orgs);
  const read = (source, program) => ({
    now: readPeriod(source, current, scope, program),
    prior: readPeriod(source, previous, scope, program),
  });
  const totals = read(data, filters.program);
  const programs = Object.entries(data.programs)
    .filter(([id]) => !filters.program || filters.program === id)
    .map(([id, name]) => ({
      label: output ? (
        name
      ) : (
        <Button
          variant="link"
          className="h-auto p-0"
          onClick={() => setProgram(id)}
        >
          {name}
        </Button>
      ),
      monetary: !!data.catalog.monetary[id],
      ...read(data, id),
    }));
  return (
    <>
      {previous && <ComparisonDates {...{ current, previous }} />}
      {!individual && (
        <PerformanceTable
          data={data}
          fixed
          title={
            filters.hierarchy ? "Direct reports" : "Program performance by team"
          }
          caption="Compare each direct report and their team. Sending and receiving rates use their respective eligible populations."
          heads={["Employee or team", ...measures]}
          groups={branches.map(({ data, label }) => ({
            label,
            ...read(data, filters.program),
          }))}
          previous={previous}
        />
      )}
      <Metrics
        items={totals.now.metrics.map((m) => [
          m.label,
          metricValue(data, m),
          m.hint,
        ])}
      />
      {previous && (
        <ComparisonTable
          data={data}
          metrics={totals.now.metrics}
          previous={totals.prior?.metrics}
          label={previous.label}
        />
      )}
      <PerformanceTable
        data={data}
        title="Program comparison"
        caption="Select a program to inspect its trend and mix. Participation uses each employee’s organization at approval."
        heads={[
          "Program",
          "Events",
          "Sending",
          "Receiving",
          "Events / active sender",
          "Funded awards (pts)",
        ]}
        groups={programs}
        previous={previous}
      />
      <div className="report-grid">
        {previous ? (
          <PeriodChart
            tab="activity"
            data={data}
            filters={filters}
            current={current}
            previous={previous}
            readings={totals.now}
            prior={totals.prior}
          />
        ) : (
          <Timeline
            events={totals.now.events}
            start={current.start}
            end={
              current.end > data.observed_through
                ? data.observed_through
                : current.end
            }
          />
        )}
        {[
          ["components", "Component mix", "Events may use several components."],
          ["category", "Categories", "Distinct events per label"],
          ["value", "Organizational values", "Distinct events per label"],
        ].map(([field, title, caption]) => {
          const counts = (reading) =>
            new Map(
              tally(reading.events.flatMap((e) => [...new Set(e[field])])),
            );
          const now = counts(totals.now);
          if (!previous)
            return (
              <Panel key={field} {...{ title, caption }}>
                <Bars items={[...now]} />
              </Panel>
            );
          const prior = totals.prior && counts(totals.prior);
          const labels = new Set([...now.keys(), ...(prior?.keys() || [])]);
          return (
            <Comparison
              key={field}
              {...{ title, caption }}
              series={["Current", previous.label]}
              rows={[...labels].map((name) => [
                name,
                now.get(name) || 0,
                prior ? prior.get(name) || 0 : null,
              ])}
            />
          );
        })}
      </div>
    </>
  );
}
