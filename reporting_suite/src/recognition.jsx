import { EmployeeDrillLink } from "./hierarchy";
import { attributeLabel } from "./employee-attributes";
import { ReportPlot } from "./period-charts";
import { Comparison } from "./charts";
import { useOption, useView } from "./view-state";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Filter, Metrics, Panel, GridTable } from "./shared";
import {
  tally,
  day,
  dayMs,
  iso,
  shortDate,
  measure,
  recognitionPeriod,
  rollingDays,
  comparisonRange,
  recognitionEvents,
} from "./metrics";

export function Bars({ items, onSelect }) {
  if (useView().output)
    return <GridTable heads={["Label", "Events"]} rows={items} />;
  if (!items.length)
    return (
      <p className="text-sm text-muted-foreground">
        No activity in this selection.
      </p>
    );
  return (
    <div className="space-y-3">
      {items.map(([name, n]) => (
        <div key={name}>
          <div className="mb-1 flex items-center justify-between text-sm">
            {onSelect ? (
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={() => onSelect(name)}
              >
                {name}
              </Button>
            ) : (
              name
            )}
            <b>{n}</b>
          </div>
          <div className="h-2 rounded bg-muted">
            <i
              className="block h-full rounded bg-blue-500"
              style={{ width: (100 * n) / items[0][1] + "%" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
export function Timeline({
  events,
  start,
  end,
  title = "Activity timeline",
  unit = "Approved events",
  color = "#3787f5",
}) {
  const { output } = useView();
  if (end < start)
    return (
      <Panel title={title} caption="Sample history ends before this window.">
        {output ? (
          <GridTable
            fixed
            heads={["Interval starting (UTC)", unit]}
            rows={[]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No observations for these dates.
          </p>
        )}
      </Panel>
    );
  const days = Math.round((day(end) - day(start)) / dayMs) + 1,
    step = Math.ceil(days / 36);
  const counts = Array(Math.ceil(days / step)).fill(0);
  for (const e of events)
    counts[Math.floor((day(e.at.slice(0, 10)) - day(start)) / dayMs / step)]++;
  if (output)
    return (
      <Panel title={title}>
        <GridTable
          heads={["Interval starting (UTC)", unit]}
          rows={counts.map((count, i) => [
            iso(new Date(+day(start) + i * step * dayMs)),
            count,
          ])}
        />
      </Panel>
    );
  const max = Math.max(1, ...counts);
  return (
    <Panel
      title={title}
      caption={unit + " per " + (step === 1 ? "day" : step + "-day interval")}
    >
      <svg
        className="chart"
        viewBox="0 0 500 150"
        role="img"
        aria-label={events.length + " " + unit.toLowerCase()}
      >
        {[...new Set([0, Math.ceil(max / 2), max])].map((n) => (
          <g key={n}>
            <text x="0" y={135 - (120 * n) / max} fontSize="12" fill="#6b7280">
              {n}
            </text>
            <path
              d={"M22 " + (131 - (120 * n) / max) + "h475"}
              stroke="#e4e4e7"
            />
          </g>
        ))}
        {counts.map((n, i) => (
          <rect
            key={i}
            x={23 + (i * 473) / counts.length}
            width={Math.min(30, 350 / counts.length)}
            y={131 - (120 * n) / max}
            height={(120 * n) / max}
            rx="2"
            fill={color}
          >
            <title>
              {iso(new Date(+day(start) + i * step * dayMs))} · {n}{" "}
              {unit.toLowerCase()}
            </title>
          </rect>
        ))}
      </svg>
      <div className="chartfoot">
        <span>{shortDate(start)}</span>
        <span>{shortDate(end)}</span>
      </div>
    </Panel>
  );
}
function Ledger({ data, events, comparison }) {
  const [search, setSearch] = useOption("search", ""),
    [component, setComponent] = useOption("component", ""),
    [page, setPage] = useState(0),
    [e, setEvent] = useState(null);
  const { output } = useView();
  const matched = events.filter(
    (e) =>
      (!component || e.components.includes(component)) &&
      [
        e.id,
        data.people[e.sender],
        ...e.recipients.map((id) => data.people[id]),
        e.message || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const last = Math.max(0, Math.ceil(matched.length / 8) - 1),
    current = Math.min(page, last),
    start = current * 8;
  const keys = data.attribute_keys;
  const attributeHeads = keys.map((k) => "Sender " + attributeLabel(k));
  const detailHeads = [
    "Approved (UTC)",
    "Sender",
    "Recipient",
    "Program",
    "Points",
  ];
  const senderAttributes = (e) =>
    data.history.find(
      (h) =>
        h.employee_id === e.sender &&
        h.valid_from <= e.at.slice(0, 10) &&
        (!h.valid_to || e.at.slice(0, 10) < h.valid_to),
    )?.attributes || {};
  if (output === "recipients")
    return (
      <GridTable
        heads={[
          ...(comparison ? ["Period", "Period from", "Period through"] : []),
          "Recognition ID",
          "Approved (UTC)",
          "Submitted (UTC)",
          "Issued (UTC)",
          "Notified (UTC)",
          "Program",
          "Sender ID",
          "Recipient ID",
          "Recipient points",
          "Components",
          "Categories",
          "Values",
          "Message",
          ...attributeHeads,
        ]}
        rows={matched.flatMap((e) =>
          e.recipients.map((id) => [
            ...(e.exportPeriod
              ? [e.exportPeriod.label, e.exportPeriod.start, e.exportPeriod.end]
              : []),
            e.id,
            e.at,
            e.submitted_at,
            e.issued_at,
            e.notified_at,
            data.programs[e.program],
            e.sender,
            id,
            e.recipient_points[id],
            e.components.join(", "),
            e.category.join(", "),
            e.value.join(", "),
            e.is_private ? "" : e.message,
            ...keys.map((k) => senderAttributes(e)[k] || ""),
          ]),
        )}
      />
    );
  const lines = e
    ? {
        Program: data.programs[e.program],
        Sender: data.people[e.sender],
        ...Object.fromEntries(
          keys.map((k) => [
            "Sender " + attributeLabel(k),
            senderAttributes(e)[k] || "—",
          ]),
        ),
        Recipients: e.recipients.map((id) => data.people[id]).join(", "),
        Submitted: e.submitted_at,
        Approved: e.at,
        Issued: e.issued_at || "Awaiting issuance",
        Notified: e.notified_at || "Awaiting notification",
        Components: e.components.join(", "),
        Categories: e.category.join(", "),
        Values: e.value.join(", "),
        Points: e.points,
        Engagement: e.likes + " likes · " + e.comments + " comments",
        Message: e.is_private ? "Private message hidden" : e.message,
      }
    : null;
  return (
    <Panel
      title="Recognition details"
      caption={
        events.reduce((s, e) => s + e.likes, 0) +
        " likes · " +
        events.reduce((s, e) => s + e.comments, 0) +
        " comments"
      }
    >
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          Search events
          <Input
            type="search"
            placeholder="Name, message, or event ID"
            value={search}
            onChange={(e) => {
              setPage(0);
              setSearch(e.target.value);
            }}
          />
        </label>
        <Filter
          label="Component"
          value={component}
          onChange={(v) => {
            setPage(0);
            setComponent(v);
          }}
          options={[
            ["", "All components"],
            ...["badge", "certificate", "ecard", "message", "points"].map(
              (c) => [c, c],
            ),
          ]}
        />
      </div>
      <GridTable
        heads={[...detailHeads, ...attributeHeads]}
        columnKey={detailHeads.join("|")}
        initiallyHidden={attributeHeads}
        rows={(output ? matched : matched.slice(start, start + 8)).map((e) => [
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => setEvent(e)}
          >
            {shortDate(e.at)}
          </Button>,
          <EmployeeDrillLink
            data={data}
            id={e.sender}
            date={e.at.slice(0, 10)}
          />,
          e.recipients.map((id) => data.people[id]).join(", "),
          data.programs[e.program],
          e.points,
          ...keys.map((k) => senderAttributes(e)[k] || "—"),
        ])}
      />
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {matched.length
            ? start + 1 + "–" + Math.min(start + 8, matched.length) + " of "
            : ""}
          {matched.length} events
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={current === last}
            onClick={() => setPage(current + 1)}
          >
            Next
          </Button>
        </div>
      </div>
      <Dialog
        open={!!e}
        onOpenChange={(open) => {
          if (!open) setEvent(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>Recognition details</DialogTitle>
          <DialogDescription>{e?.id}</DialogDescription>
          {lines && (
            <dl className="grid grid-cols-[6rem_1fr] gap-2 text-sm">
              {Object.entries(lines).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{v || "—"}</dd>
                </div>
              ))}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
export function Recognition({
  data,
  tab,
  filters,
  asOf,
  scope,
  tag,
}) {
  const { output } = useView();
  const { program } = filters;
  const { start, end } = recognitionPeriod(filters, asOf);
  if (
    !start ||
    !end ||
    end < start ||
    start < "2026-01-01" ||
    (!rollingDays[filters.period] && end > asOf)
  )
    return <p>Choose a date range between January 1 and November 10, 2026.</p>;
  const events = recognitionEvents(data, tab, start, end, scope, program, tag);
  if (output === "recipients") {
    const current = { start, end, label: "Current" };
    const comparison = comparisonRange(current, filters, asOf);
    if (!comparison)
      return rollingDays[filters.period] ? (
        <Ledger
          data={data}
          comparison
          events={events.map((e) => ({ ...e, exportPeriod: current }))}
        />
      ) : (
        <Ledger data={data} events={events} />
      );
    const otherEvents =
      comparison.start >= "2026-01-01"
        ? recognitionEvents(
            data,
            tab,
            comparison.start,
            comparison.end,
            scope,
            program,
            tag,
          )
        : [];
    return (
      <Ledger
        data={data}
        comparison
        events={[
          ...events.map((e) => ({ ...e, exportPeriod: current })),
          ...otherEvents.map((e) => ({ ...e, exportPeriod: comparison })),
        ]}
      />
    );
  }
  if (tab === "participation") {
    const calc = (p, dir) => measure(data, events, start, end, scope, p, dir),
      s = calc(program, "send"),
      r = calc(program, "receive");
    const programs = Object.entries(data.programs).filter(
      ([id]) => !program || id === program,
    );
    return (
      <>
        <Metrics
          items={[
            [
              "Sending participation",
              s.rate,
              s.active + " of " + s.total + " eligible senders",
            ],
            [
              "Receiving participation",
              r.rate,
              r.active + " of " + r.total + " eligible recipients",
            ],
            ["Eligible senders", s.total, "Distinct employees"],
            ["Eligible recipients", r.total, "Distinct employees"],
          ]}
        />
        <ReportPlot>
          <Comparison
            title="Participation by program"
            caption="Share of eligible employees who participated during the selected period."
            series={["Sending", "Receiving"]}
            max={100}
            format={(n) =>
              n == null
                ? "—"
                : n.toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%"
            }
            rows={programs.map(([id, name]) => [
              name,
              ...["send", "receive"].map((dir) => {
                const m = calc(id, dir);
                return m.total ? (100 * m.active) / m.total : null;
              }),
            ])}
          />
        </ReportPlot>
        {["send", "receive"].map((dir) => (
          <Panel
            key={dir}
            title={(dir === "send" ? "Sending" : "Receiving") + " by program"}
            caption="Program-eligible employees during the selected period"
          >
            <GridTable
              heads={["Program", "Active", "Eligible", "Rate"]}
              rows={programs.map(([id, name]) => {
                const m = calc(id, dir);
                return [name, m.active, m.total, m.rate];
              })}
            />
          </Panel>
        ))}
        <p className="text-xs text-muted-foreground">
          Participation uses eligibility and organization on the approval date.
          Combined rates count distinct employees.
        </p>
      </>
    );
  }
  return (
    <>
      <Metrics
        items={[
          ["Approved recognitions", events.length, "Distinct events"],
          [
            "Unique senders",
            new Set(events.map((e) => e.sender)).size,
            "Employees who sent",
          ],
          [
            "Unique recipients",
            new Set(events.flatMap((e) => e.recipients)).size,
            "Employees recognized",
          ],
          [
            "Points awarded",
            events.reduce((s, e) => s + e.points, 0).toLocaleString(),
            "Across recipients",
          ],
        ]}
      />
      <div className="report-grid">
        <ReportPlot>
          <Timeline {...{ events, start }} end={end > asOf ? asOf : end} />
        </ReportPlot>
        <Panel
          title="Activity by program"
          caption="Approved recognition events"
        >
          <Bars items={tally(events.map((e) => data.programs[e.program]))} />
        </Panel>
      </div>
      <Ledger data={data} events={events} />
    </>
  );
}
