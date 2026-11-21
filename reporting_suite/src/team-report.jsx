import { ChevronRight, ArrowUp, Network, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  employeeDirectory,
  childBranches,
  branchFilters,
  EmployeePath,
  HierarchyMetadata,
  employeePath,
} from "./hierarchy";
import { assignmentScope } from "./employee-attributes";
import { RecognitionTeamResults } from "./recognition-teams";
import { Recognition } from "./recognition";
import { Filter, Panel, GridTable, Metrics } from "./shared";
import {
  periodReadings,
  metricValue,
  rangeLabel,
  ComparisonDates,
  ComparisonTable,
  ComparisonDatePrompt,
} from "./period-comparison";
import { orgScope, useView } from "./view-state";
import { SummaryControls, summaryPeriod } from "./summary-controls";

export function TeamBreakdown({
  source,
  filters,
  navigate,
  dedicated = false,
  current,
  previous,
  asOf,
}) {
  const { output } = useView();
  if (!dedicated && source.viewer.role === "employee") return null;
  const directory = employeeDirectory(source);
  const path = filters.hierarchy || "";
  const individual = filters.hierarchyMode === "individual";
  const branches = childBranches(directory, path);
  const choose = (branch, mode = "team") => navigate(branch, mode);
  const options = branches.map(([branch, name]) => [
    branch,
    name,
    childBranches(directory, branch).length ? "team" : "individual",
  ]);
  if (!dedicated && path && branches.length)
    options.unshift([
      path,
      directory.get(path) + " (individual)",
      "individual",
    ]);
  const labels = [
    ["activity", "Approved recognitions"],
    ["participation", "Receiving participation"],
    ["awards", "Milestone awards"],
    ["orders", "Orders placed"],
    ["wallets", "Points balance"],
    ["funding", "Award spending"],
    ["logins", "Successful logins"],
  ]
    .filter(([tab]) => source.reports[tab])
    .slice(0, 4);
  const heads = [
    "Employee or team",
    ...labels.flatMap(([, label]) => [
      label,
      ...(output && previous ? [previous.label + " · " + label] : []),
    ]),
  ];
  const rows =
    !individual && options.length
      ? options.map(([branch, name, mode]) => {
          const selection = branchFilters(filters, branch, mode);
          const reports = assignmentScope(source, selection).reports;
          const read = (period) =>
            periodReadings(reports, period, selection, asOf).metrics;
          const now = read(current);
          const before =
            previous && previous.start >= "2026-01-01" ? read(previous) : [];
          return [
            output ? (
              name
            ) : (
              <button
                className="inline-flex items-center gap-2.5 text-left font-medium hover:underline"
                onClick={() => choose(branch, mode)}
                aria-label={"Drill into " + name}
              >
                {mode === "team" ? (
                  <Network size={16} className="text-muted-foreground" />
                ) : (
                  <UserRound size={16} className="text-muted-foreground" />
                )}
                {name}
                <ChevronRight size={14} />
              </button>
            ),
            ...labels.flatMap(([, label]) => {
              const prior = before.find((m) => m.label === label);
              const value = metricValue(
                source,
                now.find((m) => m.label === label),
              );
              if (!previous) return [value];
              const reference = prior ? metricValue(source, prior) : "—";
              if (output) return [value, reference];
              return [
                <div className="grid gap-0.5 tabular-nums">
                  <span>{value}</span>
                  <small className="text-muted-foreground">
                    {previous.label} {reference}
                  </small>
                </div>,
              ];
            }),
          ];
        })
      : [];
  if (!rows.length && (output || dedicated)) return null;
  return (
    <Panel
      title={dedicated ? (path ? "Direct reports" : "Teams") : "Team breakdown"}
      caption="Open a manager’s team or an individual employee’s report."
    >
      {!dedicated && !output && path && (
        <EmployeePath {...{ directory, path, individual, choose }} />
      )}
      {rows.length ? (
        <GridTable fixed heads={heads} rows={rows} />
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {individual
            ? "Showing this employee’s own records."
            : "Showing individual results at this level."}
        </p>
      )}
    </Panel>
  );
}

export function teamPageTitle(directory, path, mode, tab = "teams") {
  const title = {
    participation: "Participation",
    activity: "Recognition activity",
    categories: "Categories & values",
    performance: "Program performance",
    leaders: "Recognition leaderboards",
    investigation: "Approval history",
    logins: "User logins",
    teams: "Managerial hierarchy",
  }[tab];
  if (!path || !directory.has(path)) return title;
  const name =
    mode === "individual" || !childBranches(directory, path).length
      ? directory.get(path)
      : directory.get(path) + "’s team";
  return tab === "teams" ? name : title + " · " + name;
}

function IndividualRecords({ now, prior, previous }) {
  function records(read, period) {
    if (!read) return [];
    return [
      ...(read.events || []).map((e) => [
        e.at.slice(0, 10),
        "Recognition sent",
        e.id,
      ]),
      ...(read.awardRows || []).map((r) => [
        r.eligible_on,
        "Milestone award",
        r.entitlement_id,
      ]),
      ...(read.orderRows || []).map((o) => [
        o.submitted_at.slice(0, 10),
        "Order",
        o.order_id,
      ]),
    ]
      .sort((a, b) => b[0].localeCompare(a[0]) || a[2].localeCompare(b[2]))
      .map((row) => (previous ? [period, ...row] : row));
  }
  return (
    <Panel title="Individual records">
      <GridTable
        fixed
        heads={[
          ...(previous ? ["Period"] : []),
          "Date (UTC)",
          "Activity",
          "Record ID",
        ]}
        rows={[...records(now, "Current"), ...records(prior, previous?.label)]}
      />
    </Panel>
  );
}

function TeamResults({
  source,
  scoped,
  filters,
  current,
  previous,
  individual,
  asOf,
  navigate,
}) {
  const read = (range) => periodReadings(scoped.reports, range, filters, asOf);
  const now = read(current);
  const prior =
    previous && previous.start >= "2026-01-01" ? read(previous) : null;
  const labels = [
    "Approved recognitions",
    "Receiving participation",
    "Milestone awards",
    "Orders placed",
    "Points balance",
    "Award spending",
  ];
  const metrics = (reading) =>
    reading?.metrics.filter((m) => labels.includes(m.label));
  return (
    <>
      {previous && <ComparisonDates {...{ current, previous }} />}
      {!individual && (
        <TeamBreakdown
          dedicated
          source={source}
          filters={filters}
          {...{ current, previous, asOf, navigate }}
        />
      )}
      {previous ? (
        <ComparisonTable
          data={source}
          metrics={metrics(now)}
          previous={metrics(prior)}
          label={previous.label}
        />
      ) : (
        <Metrics
          items={metrics(now).map((m) => [
            m.label,
            metricValue(source, m),
            m.hint,
          ])}
        />
      )}
      {individual && <IndividualRecords {...{ now, prior, previous }} />}
    </>
  );
}

export function TeamReport({
  tab = "teams",
  tag,
  setTag,
  onTag,
  source,
  filters,
  setFilters,
  asOf,
  page,
  navigate,
  renderFilters = (controls) => controls,
}) {
  const { output, options } = useView();
  const recognitionReport = tab !== "teams";
  const path = page.managerPath ?? filters.hierarchy ?? "";
  const directory = employeeDirectory(source);
  if (path && !directory.has(path))
    return (
      <p role="alert">
        This team page is unavailable.{" "}
        {!output && (
          <button className="underline" onClick={() => navigate("")}>
            Open team directory
          </button>
        )}
      </p>
    );
  const manager = !!path && childBranches(directory, path).length > 0;
  const individual =
    !!path &&
    (!manager || (page.pageMode ?? filters.hierarchyMode) === "individual");
  const settings = branchFilters(
    filters,
    path,
    individual ? "individual" : "team",
  );
  const { current, previous, valid } = summaryPeriod(filters, asOf);
  const scoped = assignmentScope(source, settings);
  if (output === "recipients")
    return (
      <>
        {page.managerPath && (
          <HierarchyMetadata data={source} filters={settings} />
        )}
        <Recognition
          data={scoped}
          filters={settings}
          scope={orgScope(filters.org, source.orgs)}
          {...{ tab, tag, asOf }}
        />
      </>
    );
  const title = teamPageTitle(directory, path, settings.hierarchyMode, tab);
  const controls = renderFilters(
    <SummaryControls data={source} {...{ filters, setFilters, asOf }}>
      {recognitionReport && tab !== "logins" && (
        <Filter
          label="Program"
          value={filters.program}
          options={[["", "All programs"], ...Object.entries(source.programs)]}
          onChange={(program) => setFilters((old) => ({ ...old, program }))}
        />
      )}
      {tab === "activity" &&
        tag &&
        (output ? (
          <span data-filter="Recognition tag" data-value={tag.label} />
        ) : (
          <div className="text-sm">
            {tag.kind} · {tag.label}{" "}
            <Button variant="link" size="sm" onClick={() => setTag(null)}>
              Clear
            </Button>
          </div>
        ))}
      {tab === "activity" && output && options.search && (
        <span data-filter="Detail search" data-value={options.search} />
      )}
    </SummaryControls>,
  );
  const orgName = source.orgs.find((org) => org.org_id === filters.org)?.name;
  return (
    <>
      {output ? (
        <>
          <h2>{title}</h2>
          <span
            data-filter="Team report page"
            data-value={
              employeePath(directory, path)
                .map(([, name]) => name)
                .join(" › ") || "Team directory"
            }
          />
          <span
            data-filter="Page scope"
            data-value={individual ? "Individual" : "Team"}
          />
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
          <EmployeePath
            directory={directory}
            path={path}
            individual={individual && manager}
            choose={navigate}
            root="Team directory"
          />
          <div className="flex flex-wrap gap-2">
            {manager && !individual && tab !== "leaders" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(path, "individual")}
              >
                <UserRound size={14} />
                View individual report
              </Button>
            )}
            {path && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigate(
                    individual && manager
                      ? path
                      : path.split("/").slice(0, -1).join("/"),
                  )
                }
              >
                <ArrowUp size={14} />
                Up one level
              </Button>
            )}
          </div>
        </div>
      )}
      {output || recognitionReport ? (
        controls
      ) : (
        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Report settings{" "}
            <span className="ml-1 font-normal text-muted-foreground">
              {valid ? rangeLabel(current) : ""}
              {orgName && " · " + orgName}
            </span>
          </summary>
          {controls}
        </details>
      )}
      {!valid ? (
        <p role="alert">Choose a valid reporting period.</p>
      ) : filters.compare === "custom" && !previous ? (
        <ComparisonDatePrompt asOf={asOf} />
      ) : recognitionReport ? (
        <RecognitionTeamResults
          {...{ tab, tag, onTag, setFilters }}
          source={source}
          data={scoped}
          filters={settings}
          {...{ directory, current, previous, individual, asOf, navigate }}
        />
      ) : (
        <TeamResults
          source={source}
          scoped={scoped}
          filters={settings}
          {...{ current, previous, individual, asOf, navigate }}
        />
      )}
    </>
  );
}
