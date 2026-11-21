import { Button } from "@/components/ui/button";
import { Comparison } from "./charts";
import { recognitionEvents, tally } from "./metrics";
import { ComparisonDates, ComparisonTable } from "./period-comparison";
import { Bars } from "./recognition";
import { GridTable, Metrics, Panel } from "./shared";
import { orgScope, useOption, useView } from "./view-state";

const dimensions = [
  ["category", "Categories", "Recognition categories"],
  ["value", "Values", "Organizational values"],
];

function labelCounts(data, range, filters) {
  if (!range || range.start < "2026-01-01") return null;
  const events = recognitionEvents(
    data,
    "categories",
    range.start,
    range.end,
    orgScope(filters.org, data.orgs),
    filters.program,
  );
  // A recognition contributes once to each distinct label, regardless of its recipients.
  const counts = (kind) =>
    new Map(tally(events.flatMap((event) => [...new Set(event[kind])])));
  return {
    approved: events.length,
    category: counts("category"),
    value: counts("value"),
    multiple: events.filter((event) => new Set(event.value).size > 1).length,
  };
}

function labelsIn(kind, groups) {
  const names = new Set();
  for (const { now, prior } of groups) {
    for (const name of now[kind].keys()) names.add(name);
    if (prior) for (const name of prior[kind].keys()) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function change(now, prior) {
  if (prior == null) return "—";
  const diff = now - prior;
  return diff > 0 ? "+" + diff : String(diff);
}

function valuesFor(group, kind, name) {
  const count = (reading) =>
    kind === "total" ? reading.approved : reading[kind].get(name) || 0;
  return [count(group.now), group.prior ? count(group.prior) : null];
}

function TeamLabelTable({ groups, previous, path }) {
  const { output } = useView();
  const [kind, select] = useOption("teamLabelKind", "category");
  const title = path ? "Direct reports" : "Categories & values by team";
  const columns = (kind) => labelsIn(kind, groups).map((name) => [kind, name]);
  const total = ["total", "Approved recognitions"];

  if (output) {
    const measures = [total, ...columns("category"), ...columns("value")];
    return (
      <Panel title={title}>
        <GridTable
          fixed
          heads={[
            "Employee or team",
            "Type",
            "Measure",
            "Current",
            ...(previous ? [previous.label, "Change"] : []),
          ]}
          rows={groups.flatMap((group) =>
            measures.map(([kind, name]) => {
              const [now, prior] = valuesFor(group, kind, name);
              return [
                group.name,
                kind,
                name,
                now,
                ...(previous ? [prior ?? "—", change(now, prior)] : []),
              ];
            }),
          )}
        />
      </Panel>
    );
  }

  const measures = [total, ...columns(kind === "value" ? "value" : "category")];
  return (
    <Panel
      title={title}
      caption="Counts follow the sender’s team on the approval date. A recognition can appear under several labels."
    >
      <div
        className="mb-4 inline-flex gap-1 rounded-lg bg-muted p-1"
        role="group"
        aria-label="Team breakdown"
      >
        {dimensions.map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            variant={kind === id ? "outline" : "ghost"}
            aria-pressed={kind === id}
            onClick={() => select(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      <GridTable
        fixed
        heads={["Employee or team", ...measures.map(([, name]) => name)]}
        rows={groups.map((group) => [
          group.label,
          ...measures.map(([kind, name]) => {
            const [now, prior] = valuesFor(group, kind, name);
            return previous ? (
              <div className="grid gap-0.5 tabular-nums">
                <strong>{now}</strong>
                <small className="text-muted-foreground">
                  {previous.label} {prior ?? "—"} · Change {change(now, prior)}
                </small>
              </div>
            ) : (
              now
            );
          }),
        ])}
        empty="No direct reports match these filters and dates."
      />
    </Panel>
  );
}

function summary(reading) {
  return [
    ["Approved recognitions", reading.approved, "Distinct events"],
    ["Categories", reading.category.size, "Represented in period"],
    ["Values", reading.value.size, "Represented in period"],
    ["Multi-value events", reading.multiple, "Linked to multiple values"],
  ];
}

export function CategoryReport({
  data,
  filters,
  current,
  previous,
  branches,
  individual,
  onTag,
}) {
  const { output } = useView();
  const read = (source) => ({
    now: labelCounts(source, current, filters),
    prior: labelCounts(source, previous, filters),
  });
  const totals = read(data);
  const metrics = (reading) =>
    reading && summary(reading).map(([label, value]) => ({ label, value }));
  return (
    <>
      {previous && <ComparisonDates {...{ current, previous }} />}
      {!individual && (
        <TeamLabelTable
          groups={branches.map(({ data, label, name }) => ({
            label,
            name,
            ...read(data),
          }))}
          previous={previous}
          path={filters.hierarchy}
        />
      )}
      {previous ? (
        <ComparisonTable
          data={data}
          metrics={metrics(totals.now)}
          previous={metrics(totals.prior)}
          label={previous.label}
        />
      ) : (
        <Metrics items={summary(totals.now)} />
      )}
      <div className="report-grid">
        {dimensions.map(([kind, , title]) => {
          const select = onTag && ((label) => onTag({ kind, label }));
          const caption = select
            ? "Select a " + kind + " to see its approved recognitions."
            : "Approved recognitions by " + kind + ".";
          if (!previous)
            return (
              <Panel key={kind} title={title} caption={caption}>
                <Bars items={[...totals.now[kind]]} onSelect={select} />
              </Panel>
            );
          const rows = labelsIn(kind, [totals]).map((name) => [
            name,
            ...valuesFor(totals, kind, name),
          ]);
          if (output)
            return (
              <Panel key={kind} title={title}>
                <GridTable
                  fixed
                  heads={["Label", "Current", previous.label, "Change"]}
                  rows={rows.map(([name, now, prior]) => [
                    name,
                    now,
                    prior ?? "—",
                    change(now, prior),
                  ])}
                />
              </Panel>
            );
          return (
            <Comparison
              key={kind}
              {...{ title, caption, rows }}
              series={["Current", previous.label]}
              onSelect={select}
            />
          );
        })}
      </div>
    </>
  );
}
