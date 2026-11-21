import { Comparison, Distribution } from "./charts";
import { orgScope, useOption, useView } from "./view-state";
import { Panel, GridTable, Filter } from "./shared";
import { ComparisonDates, rangeLabel } from "./period-comparison";
import { orgAt } from "./metrics";
import {
  within,
  groups,
  Paged,
  Detail,
  Section,
  Search,
  timestamp,
} from "./report-tools";

const statuses = ["submitted", "pending", "approved", "rejected", "canceled"];
const titleCase = (status) => status[0].toUpperCase() + status.slice(1);

function statusCounts(requests) {
  if (!requests) return null;
  const counts = { total: requests.length };
  for (const request of requests)
    counts[request.status] = (counts[request.status] || 0) + 1;
  return counts;
}

function TeamStatuses({ branches, read, selected, previous, path }) {
  const { output } = useView();
  const measures = [
    ["total", "Total requests"],
    ...selected.map((s) => [s, titleCase(s)]),
  ];
  const rows = branches.flatMap(({ data, label }) => {
    const { now, before } = read(data);
    const counts = statusCounts(now),
      prior = statusCounts(before);
    const cells = measures.map(([key]) => {
      const current = counts[key] ?? 0;
      const comparison = prior ? (prior[key] ?? 0) : null;
      const delta = comparison === null ? null : current - comparison;
      const change =
        delta === null ? "—" : delta > 0 ? "+" + delta : String(delta);
      return [current, comparison ?? "—", change];
    });
    if (output)
      return cells.map(([now, before, change], index) => [
        label,
        measures[index][1],
        now,
        ...(previous ? [before, change] : []),
      ]);
    return [
      [
        label,
        ...cells.map(([now, before, change]) =>
          previous ? (
            <div className="grid gap-0.5 tabular-nums">
              <strong>{now}</strong>
              <small className="text-muted-foreground">
                {previous.label} {before} · Change {change}
              </small>
            </div>
          ) : (
            now
          ),
        ),
      ],
    ];
  });
  return (
    <Panel
      title={path ? "Direct reports" : "Approval history by team"}
      caption="Each row includes the direct report and their team at submission. Status reflects the latest recorded state."
    >
      <GridTable
        fixed
        heads={
          output
            ? [
                "Employee or team",
                "Measure",
                "Current",
                ...(previous ? [previous.label, "Change"] : []),
              ]
            : ["Employee or team", ...measures.map(([, name]) => name)]
        }
        rows={rows}
        empty="No direct reports match these filters and dates."
      />
    </Panel>
  );
}

function RequestLedger({ data, requests, names, title, range }) {
  return (
    <Panel
      title={title}
      caption={`${requests.length} ${requests.length === 1 ? "request" : "requests"} submitted ${rangeLabel(range)}. Select a request to see its approval history.`}
    >
      <Paged
        heads={[
          "Request",
          "Submitted",
          "Program",
          "Sender",
          "Recipients",
          "Status",
          "Current stage",
        ]}
        rows={requests.map((r) => [
          <Detail
            trigger={r.recognition_id}
            title="Approval history"
            caption={r.recognition_id + " · " + r.status}
          >
            <GridTable
              heads={[
                "Stage",
                "Responsible approver",
                "Approved",
                "Issued",
                "Notified",
              ]}
              rows={[
                [
                  r.current_stage || "Complete",
                  data.people[r.responsible_approver_id] || "—",
                  timestamp(r.approved_at),
                  timestamp(r.issued_at),
                  timestamp(r.notified_at),
                ],
              ]}
            />
            <Section title="Chronological steps">
              <GridTable
                heads={["Time", "Stage", "Action", "Actor", "Reason"]}
                rows={data.catalog.steps
                  .filter((s) => s.recognition_id === r.recognition_id)
                  .map((s) => [
                    timestamp(s.occurred_at),
                    s.stage,
                    s.action,
                    data.people[s.actor_id],
                    s.reason || "—",
                  ])}
              />
            </Section>
          </Detail>,
          r.submitted_at.slice(0, 10),
          data.programs[r.program_id],
          data.people[r.sender_id],
          names(r),
          r.status,
          r.current_stage || "—",
        ])}
      />
    </Panel>
  );
}

export function Investigation({
  data,
  filters,
  current,
  previous,
  branches,
  individual,
}) {
  const [status, setStatus] = useOption("status", "");
  const [query, setQuery] = useOption("query", "");
  const recipients = new Map(
    groups(data.catalog.request_recipients, (r) => r.recognition_id),
  );
  const names = (r) =>
    (recipients.get(r.recognition_id) || [])
      .map((a) => data.people[a.employee_id])
      .join(", ");
  const search = query.trim().toLowerCase();
  const scope = orgScope(filters.org, data.orgs);
  const candidates = data.catalog.requests.filter(
    (r) =>
      (!filters.program || r.program_id === filters.program) &&
      (!status || r.status === status) &&
      (!search ||
        [r.recognition_id, data.people[r.sender_id], names(r)]
          .join(" ")
          .toLowerCase()
          .includes(search)),
  );
  const inRange = (range) =>
    candidates.filter((r) => within(r.submitted_at, range.start, range.end));
  const currentRequests = inRange(current);
  const comparisonRequests =
    previous?.start >= "2026-01-01" ? inRange(previous) : null;
  const read = (source) => {
    const inTeam = (r) =>
      orgAt(source, r.sender_id, r.submitted_at.slice(0, 10), scope);
    return {
      now: currentRequests.filter(inTeam),
      before: comparisonRequests?.filter(inTeam),
    };
  };
  const { now, before } = read(data);
  const counts = statusCounts(now),
    prior = statusCounts(before);
  const selected = status ? [status] : statuses;
  const select = (s) => setStatus(s === status ? "" : s);
  const title = "Requests by approval status";
  const caption =
    "Requests are grouped by submission date and show their status at the data snapshot. Select a status to filter.";
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <Filter
          label="Request status"
          value={status}
          onChange={setStatus}
          options={[
            ["", "All statuses"],
            ...statuses.map((s) => [s, titleCase(s)]),
          ]}
        />
        <Search
          value={query}
          onChange={setQuery}
          placeholder="Request ID, sender, or recipient"
        />
      </div>
      {previous && <ComparisonDates {...{ current, previous }} />}
      {!individual && (
        <TeamStatuses
          {...{ branches, read, selected, previous }}
          path={filters.hierarchy}
        />
      )}
      {previous ? (
        <Comparison
          {...{ title, caption }}
          series={["Current", previous.label]}
          rows={selected.map((s) => [
            titleCase(s),
            counts[s] ?? 0,
            prior ? (prior[s] ?? 0) : null,
          ])}
          onSelect={(label) => select(label.toLowerCase())}
        />
      ) : (
        <Distribution
          {...{ title, caption }}
          unit="Requests"
          rows={selected
            .filter((s) => counts[s])
            .map((s) => [titleCase(s), counts[s], s])}
          onSelect={select}
        />
      )}
      <RequestLedger
        title="Recognition requests"
        data={data}
        requests={now}
        range={current}
        names={names}
      />
      {before && (
        <RequestLedger
          title={previous.label + " period requests"}
          data={data}
          requests={before}
          range={previous}
          names={names}
        />
      )}
    </>
  );
}
