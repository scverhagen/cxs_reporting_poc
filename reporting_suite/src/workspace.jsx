import { reportRange, selectedRollingPeriod, rollingDays } from "./metrics";
import { defaults } from "./view-state";
import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  CalendarClock,
  Download,
  FolderOpen,
  Mail,
  Play,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Filter } from "./shared";

const sections = [
  ["views", "Saved views", Bookmark],
  ["schedules", "Schedules", CalendarClock],
  ["exports", "Exports", Download],
];
const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const when = (n) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(n * 1000) + " UTC";

function ItemActions({ item, send, busy }) {
  const [edit, setEdit] = useState(false),
    [name, setName] = useState(item.name),
    [confirm, setConfirm] = useState(false);
  if (edit)
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await send({ action: "rename", id: item.id, name }))
            setEdit(false);
        }}
      >
        <Input
          aria-label="New name"
          className="max-w-52"
          autoFocus
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button size="sm" disabled={busy}>
          Save name
        </Button>
        <Button
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => setEdit(false)}
        >
          Cancel
        </Button>
      </form>
    );
  if (confirm)
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>Delete this {item.kind === "save" ? "view" : "schedule"}?</span>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={() => send({ action: "delete", id: item.id })}
        >
          Delete
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
          Cancel
        </Button>
      </div>
    );
  return (
    <div className="flex gap-1">
      <Button
        variant="ghost"
        size="icon"
        title="Rename"
        aria-label={"Rename " + item.name}
        onClick={() => {
          setName(item.name);
          setEdit(true);
        }}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Delete"
        aria-label={"Delete " + item.name}
        onClick={() => setConfirm(true)}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function CustomRanges({ view, asOf }) {
  const days =
    rollingDays[selectedRollingPeriod(view.tab, view.filters, view.options)];
  if (view.filters.compare !== "custom")
    return days ? (
      <span className="block text-xs text-muted-foreground">
        Last {days} days · resolves at run time
        {view.filters.compare === "previous" ? " · Previous period" : ""}
      </span>
    ) : null;
  const filters = { ...defaults, ...view.filters };
  const current = reportRange(view.tab, filters, view.options, asOf);
  return (
    <span className="block text-xs text-muted-foreground">
      {days ? "Last " + days + " days" : "Current"} {current?.start || "…"} –{" "}
      {current?.end || "…"} · Comparison {filters.comparisonStart || "…"} –{" "}
      {filters.comparisonEnd || "…"}
    </span>
  );
}

export function Workspace({
  customer,
  customerName,
  asOf,
  role,
  reports,
  pageTitle,
  view,
  load,
}) {
  const [section, setSection] = useState(null),
    [name, setName] = useState(""),
    [cadence, setCadence] = useState("weekly"),
    [weekday, setWeekday] = useState("0"),
    [clock, setClock] = useState("09:00"),
    [format, setFormat] = useState("report"),
    [data, setData] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const version = useRef(0),
    pending = useRef(false);
  const context = new URLSearchParams({ customer, role }).toString();
  const endpoint = "/api/workspace?" + context;
  const title = pageTitle || reports[view.tab]?.[0] || "";
  const open = (key) => {
    setError("");
    setNotice("");
    setFormat("report");
    setName(title);
    setSection(key);
  };
  useEffect(() => {
    if (!section) return;
    const controller = new AbortController();
    async function refresh() {
      if (pending.current) return;
      const ticket = ++version.current;
      try {
        const r = await fetch(endpoint, { signal: controller.signal });
        if (!r.ok) throw Error("Could not load the customer workspace.");
        const result = await r.json();
        if (!controller.signal.aborted && ticket === version.current)
          setData(result);
      } catch (e) {
        if (!controller.signal.aborted) setError(e.message);
      }
    }
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [endpoint, section]);
  async function send(payload, feedback) {
    if (pending.current) return false;
    pending.current = true;
    version.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Could not save your changes.");
      setData(result);
      setNotice(feedback || "Changes saved.");
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const items =
    data?.items.filter(
      (i) => i.kind === (section === "views" ? "save" : "schedule"),
    ) || [];
  const formLabel = section === "views" ? "View name" : "Schedule name";
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {sections.map(([id, label, Icon]) => (
          <Button key={id} variant="outline" size="sm" onClick={() => open(id)}>
            <Icon />
            {label}
          </Button>
        ))}
      </div>
      <Dialog
        open={!!section}
        onOpenChange={(yes) => {
          if (!yes) setSection(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] gap-4 overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Report workspace</DialogTitle>
            <DialogDescription>
              {customerName} · Demo {role}
            </DialogDescription>
          </DialogHeader>
          <nav
            aria-label="Report workspace"
            className="flex flex-wrap gap-1 border-b pb-2"
          >
            {sections.map(([id, label, Icon]) => (
              <Button
                key={id}
                size="sm"
                variant={section === id ? "secondary" : "ghost"}
                aria-current={section === id ? "page" : undefined}
                onClick={() => open(id)}
              >
                <Icon />
                {label}
              </Button>
            ))}
          </nav>
          {view.tab && (
            <form
              className="grid gap-3 rounded-xl border bg-muted/30 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                const action = {
                  views: "save",
                  schedules: "schedule",
                  exports: "export",
                }[section];
                send(
                  {
                    action,
                    name: section === "exports" ? title : name,
                    view,
                    cadence,
                    weekday: Number(weekday),
                    clock,
                    format,
                  },
                  {
                    save: "View saved.",
                    schedule: "Schedule created.",
                    export: "Export queued.",
                  }[action],
                );
              }}
            >
              <div>
                <h3 className="text-sm font-semibold">
                  {
                    {
                      views: "Save current view",
                      schedules: "Schedule current report",
                      exports: "Export current report",
                    }[section]
                  }
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {title} ·{" "}
                  {view.tab === "overview"
                    ? "Selected period and organization"
                    : "Current filters and table columns"}
                  {view.filters.compare === "previous" &&
                    " · Compared with previous period"}
                  <CustomRanges {...{ view, asOf }} />
                </p>
              </div>
              {section !== "exports" && (
                <label className="grid gap-1.5 text-xs font-medium">
                  {formLabel}
                  <Input
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              {section === "schedules" && (
                <>
                  <div className="flex flex-wrap items-end gap-2">
                    <Filter
                      label="Frequency"
                      value={cadence}
                      onChange={setCadence}
                      options={[
                        ["daily", "Daily"],
                        ["weekly", "Weekly"],
                      ]}
                    />
                    {cadence === "weekly" && (
                      <Filter
                        label="Day"
                        value={weekday}
                        onChange={setWeekday}
                        options={days.map((d, i) => [String(i), d])}
                      />
                    )}
                    <label className="grid gap-1.5 text-xs font-medium">
                      Delivery time (UTC)
                      <Input
                        type="time"
                        required
                        value={clock}
                        onChange={(e) => setClock(e.target.value)}
                      />
                    </label>
                  </div>
                  <span className="flex gap-2 text-xs text-muted-foreground">
                    <Mail size={15} /> Deliver to your demo inbox in Exports.
                  </span>
                </>
              )}
              {section === "exports" &&
                (view.tab === "activity" ? (
                  <Filter
                    label="CSV contents"
                    value={format}
                    onChange={setFormat}
                    options={[
                      ["report", "Report tables and summary"],
                      [
                        "recipients",
                        "Recipient detail · one row per recipient",
                      ],
                    ]}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {view.tab === "overview"
                      ? "CSV includes the key numbers and the data behind each visible chart."
                      : "CSV includes every page of the report tables."}
                  </p>
                ))}
              <div>
                <Button size="sm" disabled={busy}>
                  {section === "exports" ? <Download /> : <Plus />}
                  {
                    {
                      views: "Save view",
                      schedules: "Create schedule",
                      exports: "Generate CSV",
                    }[section]
                  }
                </Button>
              </div>
            </form>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          <div>
            <h3 className="mb-2 text-sm font-semibold">
              {
                {
                  views: "Your saved views",
                  schedules: "Scheduled deliveries",
                  exports: "Delivery inbox",
                }[section]
              }
            </h3>
            {!data ? (
              <p role="status">Loading…</p>
            ) : section === "exports" ? (
              data.jobs.length ? (
                data.jobs.map((j) => (
                  <article
                    key={j.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="break-all text-sm">{j.name}</strong>
                        <Badge variant="secondary">{j.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {j.origin} ·{" "}
                        {j.format === "recipients"
                          ? "Recipient detail"
                          : "Report CSV"}{" "}
                        · {when(j.created)}
                      </p>
                      {j.status === "ready" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Link expires {when(j.expires)}
                        </p>
                      )}
                      {j.error && (
                        <p className="text-xs text-destructive">{j.error}</p>
                      )}
                    </div>
                    {j.status === "ready" && (
                      <div className="flex items-center gap-1">
                        <Button asChild variant="ghost" size="icon">
                          <a
                            aria-label={"Download delivery email for " + j.name}
                            title="Download delivery email"
                            download
                            href={`/api/email?${context}&token=${encodeURIComponent(j.token)}`}
                          >
                            <Mail />
                          </a>
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <a
                            download
                            href={
                              "/api/download?" +
                              context +
                              "&token=" +
                              encodeURIComponent(j.token)
                            }
                          >
                            <Download />
                            Download CSV
                          </a>
                        </Button>
                      </div>
                    )}
                  </article>
                ))
              ) : (
                <Empty text="Generated files and scheduled deliveries will appear here." />
              )
            ) : items.length ? (
              items.map((item) => (
                <article
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-t py-3"
                >
                  <div className="min-w-0">
                    <strong className="break-all text-sm">{item.name}</strong>
                    <p className="text-xs text-muted-foreground">
                      {reports[item.view.tab]?.[0]}
                      {!item.available && " · Access unavailable"}
                      <CustomRanges view={item.view} asOf={asOf} />
                    </p>
                    {section === "schedules" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.cadence === "daily"
                          ? "Daily"
                          : days[item.weekday] + "s"}{" "}
                        at {item.clock} UTC ·{" "}
                        {item.next_run
                          ? "Next " + when(item.next_run)
                          : "Paused"}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {section === "views" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!item.available}
                        onClick={() => {
                          load(item.view);
                          setSection(null);
                        }}
                      >
                        <FolderOpen />
                        Open view
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !item.available}
                          onClick={() =>
                            send(
                              { action: "run", id: item.id },
                              "Report queued. Open Exports to download it.",
                            )
                          }
                        >
                          <Play />
                          Run now
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || (!item.next_run && !item.available)}
                          onClick={() =>
                            send({
                              action: item.next_run ? "pause" : "resume",
                              id: item.id,
                            })
                          }
                        >
                          {item.next_run ? "Pause" : "Resume"}
                        </Button>
                      </>
                    )}
                    <ItemActions {...{ item, send, busy }} />
                  </div>
                </article>
              ))
            ) : (
              <Empty
                text={
                  section === "views"
                    ? "No saved views for this role and customer yet."
                    : "No scheduled deliveries for this role and customer yet."
                }
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
function Empty({ text }) {
  return (
    <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
      {text}
    </p>
  );
}
