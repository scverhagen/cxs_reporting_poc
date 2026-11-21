import { Button } from "@/components/ui/button";
import { Comparison } from "./charts";
import { measure, recognitionEvents } from "./metrics";
import { ComparisonDates } from "./period-comparison";
import { fmt, Paged } from "./report-tools";
import { Filter, GridTable, Panel } from "./shared";
import { orgScope, useOption, useView } from "./view-state";

const suppressed = "Suppressed";
const unavailable = "—";

function population(data, range, scope, program, direction, events) {
  const eventIds = new Set();
  const people = new Map();
  const { active, total } = measure(
    data,
    events,
    range.start,
    range.end,
    scope,
    program,
    direction,
    (event, id) => {
      eventIds.add(event.id);
      people.set(id, (people.get(id) || 0) + 1);
    },
  );
  if (total < data.catalog.minimum_group || !total) return null;
  return {
    events: eventIds.size,
    eligible: total,
    active,
    people,
    frequency: eventIds.size / total,
    rate: (100 * active) / total,
  };
}

function reading(data, range, scope, program, direction) {
  if (!range || range.start < "2026-01-01") return null;
  const events = recognitionEvents(
    data,
    "participation",
    range.start,
    range.end,
    scope,
    program,
  );
  const selected = population(data, range, scope, program, direction, events);
  if (!selected) return null;
  const opposite = population(
    data,
    range,
    scope,
    program,
    direction === "send" ? "receive" : "send",
    events,
  );
  return {
    ...selected,
    opposite: opposite?.events ?? suppressed,
    oppositePeople: opposite?.people,
  };
}

// Only reportable scores participate in ranking, including when calculating ties.
function rankRows(rows, field, includeZero = true) {
  for (const period of ["now", "before"]) {
    const sorted = rows
      .filter((row) => {
        const score = row[period]?.[field];
        return Number.isFinite(score) && (includeZero || score > 0);
      })
      .sort((a, b) => b[period][field] - a[period][field]);
    sorted.forEach((row, index) => {
      const previous = sorted[index - 1]?.[period];
      row[period].rank =
        row[period][field] === previous?.[field] ? previous.rank : index + 1;
    });
  }
  return rows.sort(
    (a, b) =>
      (a.now?.rank ?? Infinity) - (b.now?.rank ?? Infinity) ||
      (a.before?.rank ?? Infinity) - (b.before?.rank ?? Infinity) ||
      a.name.localeCompare(b.name),
  );
}

function display(value, key, delta = false) {
  if (!Number.isFinite(value)) return value ?? unavailable;
  const number =
    key === "rate" ? Number(value.toFixed(1)) : Number(value.toFixed(2));
  return (
    (delta && number > 0 ? "+" : "") +
    fmt(number) +
    (key === "rate" ? (delta ? " pp" : "%") : "")
  );
}

function RankingTable({
  title,
  caption,
  rows,
  columns,
  previous,
  paged,
  empty,
}) {
  const { output } = useView();
  const Table = paged ? Paged : GridTable;
  const heads = columns.map(([head]) => head);
  const periodColumn = output && previous;
  const values = (row, period) =>
    columns.map(([, key]) => {
      if (key === "name") return row.label;
      if (period === "change") {
        const now = row.now?.[key],
          prior = row.before?.[key];
        return key !== "rank" && Number.isFinite(now) && Number.isFinite(prior)
          ? display(now - prior, key, true)
          : unavailable;
      }
      const group = row[period];
      if (!group)
        return period === "before" && previous?.start < "2026-01-01"
          ? unavailable
          : suppressed;
      return display(group[key], key);
    });
  const tableRows = rows.flatMap((row) => {
    const now = values(row, "now");
    if (!previous) return [now];
    const before = values(row, "before"),
      change = values(row, "change");
    if (periodColumn)
      return [
        ["Current", ...now],
        [previous.label, ...before],
        ["Change", ...change],
      ];
    return [
      now.map((value, i) =>
        columns[i][1] === "name" ? (
          value
        ) : (
          <div className="grid gap-0.5 tabular-nums">
            <span className="font-medium">{value}</span>
            <small className="text-muted-foreground">
              {previous.label} {before[i]}
              {change[i] !== unavailable && " · " + change[i]}
            </small>
          </div>
        ),
      ),
    ];
  });
  return (
    <Panel title={title} caption={caption}>
      <Table
        heads={periodColumn ? ["Period", ...heads] : heads}
        columnKey={heads.join("|")}
        rows={tableRows}
        empty={empty}
      />
    </Panel>
  );
}

function individualReading(group, id) {
  if (!group) return null;
  return {
    events: group.people.get(id) ?? 0,
    opposite: group.oppositePeople
      ? group.oppositePeople.get(id) || 0
      : suppressed,
  };
}

export function Leaderboards({
  data,
  filters,
  current,
  previous,
  branches,
  individual,
  setOrg,
}) {
  const [direction, setDirection] = useOption("direction", "send");
  const { output } = useView();
  const scope = orgScope(filters.org, data.orgs);
  const threshold = data.catalog.minimum_group;
  const selected = direction === "send" ? "Sent" : "Received";
  const other = direction === "send" ? "Received" : "Sent";
  const rule =
    "At least " +
    threshold +
    " eligible employees are required in each period and direction.";
  const read = (source, unit) => ({
    now: reading(source, current, unit, filters.program, direction),
    before: reading(source, previous, unit, filters.program, direction),
  });
  const team = read(data, scope);
  const visible = (row) => row.now || row.before;
  const controls = (
    <>
      <Filter
        label="Rank by"
        value={direction}
        onChange={setDirection}
        options={[
          ["send", "Sent recognition"],
          ["receive", "Received recognition"],
        ]}
      />
      {output && (
        <span data-filter="Minimum eligible employees" data-value={threshold} />
      )}
      {previous && <ComparisonDates {...{ current, previous }} />}
    </>
  );
  if (!visible(team))
    return (
      <>
        {controls}
        <Panel title="Team summary" caption={rule}>
          <GridTable fixed heads={["Reporting status"]} rows={[[suppressed]]} />
        </Panel>
      </>
    );
  const teams = rankRows(
    branches
      .map(({ data: branch, label, name }) => ({
        name,
        label,
        ...read(branch, scope),
      }))
      .filter(visible),
    "frequency",
  );
  const parents = new Set(data.orgs.map((org) => org.parent_org_id));
  const departments = rankRows(
    data.orgs
      .filter(
        (org) => !parents.has(org.org_id) && (!scope || scope.has(org.org_id)),
      )
      .map(({ org_id, name }) => ({
        name,
        label: output ? (
          name
        ) : (
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => setOrg(org_id)}
          >
            {name}
          </Button>
        ),
        ...read(data, new Set([org_id])),
      }))
      .filter(visible),
    "frequency",
  );
  const ids = new Set([
    ...(team.now?.people.keys() || []),
    ...(team.before?.people.keys() || []),
  ]);
  const people = rankRows(
    [...ids].map((id) => ({
      name: data.people[id],
      label: data.people[id],
      now: individualReading(team.now, id),
      before: individualReading(team.before, id),
    })),
    "events",
    false,
  );
  const metrics = [
    ["Events", "events"],
    ["Eligible", "eligible"],
    ["Active", "active"],
    ["Events / eligible", "frequency"],
    ["Participation", "rate"],
    [other + " events", "opposite"],
  ];
  const ranked = (name) => [["Rank", "rank"], [name, "name"], ...metrics];
  return (
    <>
      {controls}
      <RankingTable
        title="Team summary"
        caption={rule}
        previous={previous}
        columns={[["Scope", "name"], ...metrics]}
        rows={[{ label: "Selected population", ...team }]}
      />
      {!individual && (
        <RankingTable
          title="Direct reports"
          previous={previous}
          caption={
            "Ranked by approved events per eligible employee. Select a direct report to open their team. " +
            rule
          }
          rows={teams}
          columns={ranked("Direct report")}
          empty="No direct report meets the reporting threshold."
        />
      )}
      <Comparison
        title="Recognition frequency by department"
        caption={"Approved events per eligible employee. " + rule}
        series={
          previous
            ? ["Current", previous.label]
            : ["Events per eligible employee"]
        }
        rows={departments.map(({ name, now, before }) => [
          name,
          now?.frequency,
          ...(previous ? [before?.frequency] : []),
        ])}
        format={(n) => (Number.isFinite(n) ? fmt(n) : unavailable)}
      />
      <RankingTable
        title="Department rankings"
        caption={"Ranked by events per eligible employee. " + rule}
        rows={departments}
        columns={ranked("Department")}
        previous={previous}
        empty="No department meets the reporting threshold."
      />
      <RankingTable
        paged
        title="Individual rankings"
        previous={previous}
        caption={
          "Approved events " +
          selected.toLowerCase() +
          " in the selected population. Equal counts share a rank."
        }
        rows={people}
        columns={[
          ["Rank", "rank"],
          ["Employee", "name"],
          [selected, "events"],
          [other, "opposite"],
        ]}
        empty="No reportable individual rankings in this selection."
      />
    </>
  );
}
