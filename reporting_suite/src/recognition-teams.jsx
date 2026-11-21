import { ChevronRight, Network, UserRound } from "lucide-react";
import { assignmentScope } from "./employee-attributes";
import { branchFilters, childBranches } from "./hierarchy";
import {
  metricChange,
  metricValue,
  periodReadings,
  ReportComparison,
} from "./period-comparison";
import { Investigation } from "./oversight";
import { UserLogins } from "./user-logins";
import { Leaderboards } from "./leaderboards";
import { Performance } from "./performance";
import { CategoryReport } from "./category-report";
import { Recognition } from "./recognition";
import { GridTable, Panel } from "./shared";
import { orgScope, useView } from "./view-state";

function recognitionBranches(
  source,
  filters,
  directory,
  current,
  previous,
  reportName,
  navigate,
  output,
) {
  const scope = orgScope(filters.org, source.orgs);
  const ranges = [current, previous].filter(
    (range) => range && range.start >= "2026-01-01",
  );
  const branches = [];
  for (const [branch, name] of childBranches(directory, filters.hierarchy)) {
    const team = childBranches(directory, branch).length > 0;
    const mode = team ? "team" : "individual";
    const settings = branchFilters(filters, branch, mode);
    const data = assignmentScope(source, settings);
    if (
      !data.history.some(
        (h) =>
          (!scope || scope.has(h.org_id)) &&
          ranges.some(
            ({ start, end }) =>
              h.valid_from <= end && (!h.valid_to || h.valid_to > start),
          ),
      )
    )
      continue;
    const Icon = team ? Network : UserRound;
    const label = output ? (
      name
    ) : (
      <button
        className="inline-flex items-center gap-2 text-left font-medium hover:underline"
        aria-label={"Open " + reportName.toLowerCase() + " for " + name}
        onClick={() => navigate(branch, mode)}
      >
        <Icon size={16} className="shrink-0 text-muted-foreground" />
        {name}
        <ChevronRight size={14} className="shrink-0" />
      </button>
    );
    branches.push({ data, label, name });
  }
  return branches;
}

function RecognitionTeams({
  tab,
  tag,
  source,
  filters,
  current,
  previous,
  asOf,
  branches,
}) {
  const { output } = useView();
  const reference = previous?.start >= "2026-01-01" ? previous : null;
  const activity = tab === "activity";
  const title = activity ? "Recognition activity" : "Participation";
  const rates = ["Sending", "Receiving"];
  function rateCells(metric, prior) {
    const value = metricValue(source, metric);
    const comparison = prior ? metricValue(source, prior) : "—";
    const change = metricChange(source, metric, prior);
    if (output)
      return [
        value,
        metric.hint,
        ...(previous ? [comparison, prior?.hint || "—", change] : []),
      ];
    return [
      <div className="grid gap-0.5 tabular-nums">
        <span className="font-medium">{value}</span>
        <small className="text-muted-foreground">{metric.hint}</small>
        {previous && (
          <small className="text-muted-foreground">
            {previous.label} {comparison}
            {prior && " · " + prior.hint}
            {change !== "—" && " · " + change}
          </small>
        )}
      </div>,
    ];
  }
  const rows = [];
  for (const { data, label } of branches) {
    const read = (range) =>
      periodReadings({ [tab]: data }, range, filters, asOf, {}, tag).metrics;
    const now = read(current);
    const before = reference ? read(reference) : [];
    if (activity) {
      const count = now.find(
        (metric) => metric.label === "Approved recognitions",
      );
      const prior = before.find((metric) => metric.label === count.label);
      rows.push([
        label,
        metricValue(source, count),
        ...(previous
          ? [
              prior ? metricValue(source, prior) : "—",
              metricChange(source, count, prior),
            ]
          : []),
      ]);
    } else {
      rows.push([
        label,
        ...now.flatMap((metric, index) => rateCells(metric, before[index])),
      ]);
    }
  }
  return (
    <Panel
      title={filters.hierarchy ? "Direct reports" : title + " by team"}
      caption={
        activity
          ? "Each row counts recognitions sent by that person and their team, using the reporting line on the approval date."
          : "A manager’s row includes everyone in their branch. Select a name to see team or individual participation."
      }
    >
      <GridTable
        fixed
        heads={
          activity
            ? [
                "Employee or team",
                "Approved recognitions",
                ...(previous ? [previous.label, "Change"] : []),
              ]
            : [
                "Employee or team",
                ...rates.flatMap((rate) =>
                  output
                    ? [
                        rate + " rate",
                        rate + " population",
                        ...(previous
                          ? [
                              previous.label +
                                " " +
                                rate.toLowerCase() +
                                " rate",
                              previous.label +
                                " " +
                                rate.toLowerCase() +
                                " population",
                              rate + " change",
                            ]
                          : []),
                      ]
                    : [rate + " participation"],
                ),
              ]
        }
        rows={rows}
        empty="No direct reports match these filters and dates."
      />
    </Panel>
  );
}

export function RecognitionTeamResults({
  tab,
  setFilters,
  onTag,
  tag,
  source,
  data,
  directory,
  filters,
  current,
  previous,
  individual,
  asOf,
  navigate,
}) {
  const { output } = useView();
  const reportName = {
    categories: "Categories & values",
    performance: "Program performance",
    leaders: "Recognition leaderboards",
    investigation: "Approval history",
    logins: "User logins",
    activity: "Recognition activity",
    participation: "Participation",
  }[tab];
  const branches = individual
    ? []
    : recognitionBranches(
        source,
        filters,
        directory,
        current,
        previous,
        reportName,
        navigate,
        output,
      );
  if (tab === "logins")
    return (
      <UserLogins
        {...{ data, filters, current, previous, branches, individual }}
      />
    );
  if (tab === "investigation")
    return (
      <Investigation
        {...{ data, filters, current, previous, individual, branches }}
      />
    );
  if (tab === "leaders")
    return (
      <Leaderboards
        {...{ data, filters, current, previous, branches, individual }}
        setOrg={(org) => setFilters((old) => ({ ...old, org }))}
      />
    );
  if (tab === "performance")
    return (
      <Performance
        {...{ data, filters, current, previous, individual, branches, asOf }}
        setProgram={(program) => setFilters((old) => ({ ...old, program }))}
      />
    );
  if (tab === "categories")
    return (
      <CategoryReport
        {...{ data, filters, current, previous, individual, branches, onTag }}
      />
    );
  const props = { tab, data, filters, asOf, tag };
  return (
    <>
      {!individual && (
        <RecognitionTeams
          {...{ tab, tag, source, filters, current, previous, asOf, branches }}
        />
      )}
      <ReportComparison {...props}>
        <Recognition
          key={JSON.stringify([filters, tag])}
          {...props}
          scope={orgScope(filters.org, data.orgs)}
        />
      </ReportComparison>
    </>
  );
}
