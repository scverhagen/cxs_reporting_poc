import { Button } from "@/components/ui/button";
import { loginMeasures, loginReading } from "./login-metrics";
import {
  ComparisonDates,
  ComparisonTable,
  metricChange,
  rangeLabel,
} from "./period-comparison";
import { PeriodChart } from "./period-charts";
import { Paged, timestamp } from "./report-tools";
import { GridTable, Metrics, Panel } from "./shared";
import { orgScope, useOption, useView } from "./view-state";

export function UserLogins({
  data,
  filters,
  current,
  previous,
  branches,
  individual,
}) {
  const { output } = useView();
  const [detail, setDetail] = useOption("loginDetail", "all");
  const withoutLogin = detail === "withoutLogin";
  const scope = orgScope(filters.org, data.orgs);
  const read = (source, range) => loginReading(source, range, scope);
  const now = read(data, current),
    before = read(data, previous);
  const metrics = (group) =>
    loginMeasures.map(([key, label]) => ({ label, value: group?.[key] }));
  const currentEmployees = now?.employees ?? new Map();
  const employeeIds = withoutLogin
    ? [...currentEmployees.keys()].filter(
        (id) => currentEmployees.get(id).count === 0,
      )
    : [
        ...new Set([
          ...currentEmployees.keys(),
          ...(before?.employees.keys() || []),
        ]),
      ];
  employeeIds.sort(
    (a, b) =>
      data.people[a].localeCompare(data.people[b]) || a.localeCompare(b),
  );
  const employeeCells = (reading, id) => {
    const user = reading?.employees.get(id);
    return [user?.count ?? "—", timestamp(user?.last)];
  };
  const employeeList = (
    <Panel
      title={
        withoutLogin ? "Users without a login" : "Login history by employee"
      }
      caption={
        withoutLogin
          ? now
            ? `${employeeIds.length} ${employeeIds.length === 1 ? "employee" : "employees"} with no successful sign-in · ${rangeLabel(current)}`
            : rangeLabel(current)
          : "Counts and latest successful login in each selected period. Times are UTC."
      }
    >
      <Paged
        heads={[
          "Employee",
          ...(withoutLogin
            ? ["Employee ID", "Logins"]
            : ["Logins", "Last login (UTC)"]),
          ...(previous
            ? [previous.label + " logins", previous.label + " last login (UTC)"]
            : []),
        ]}
        rows={employeeIds.map((id) => [
          data.people[id],
          ...(withoutLogin
            ? [id, currentEmployees.get(id).count]
            : employeeCells(now, id)),
          ...(previous ? employeeCells(before, id) : []),
        ])}
        empty={
          !now && withoutLogin
            ? "Login data is unavailable for the selected period."
            : withoutLogin && currentEmployees.size > 0
              ? "Every employee in scope signed in during the selected period."
              : "No employees in scope for the selected dates."
        }
      />
    </Panel>
  );
  if (withoutLogin)
    return (
      <>
        {previous && <ComparisonDates {...{ current, previous }} />}
        {output && (
          <span
            data-filter="Employee list"
            data-value="Users without a login"
          />
        )}
        {output && (
          <span
            data-filter="Matching employees"
            data-value={now ? employeeIds.length : "Unavailable"}
          />
        )}
        {employeeList}
        {!output && (
          <Button variant="outline" onClick={() => setDetail("all")}>
            Show all login activity
          </Button>
        )}
      </>
    );
  return (
    <>
      {previous && <ComparisonDates {...{ current, previous }} />}
      {previous ? (
        <ComparisonTable
          data={data}
          metrics={metrics(now)}
          previous={before && metrics(before)}
          label={previous.label}
        />
      ) : (
        <Metrics
          items={loginMeasures.map(([key, label, hint]) => [
            label,
            now?.[key] ?? "—",
            hint,
          ])}
        />
      )}
      <PeriodChart
        tab="logins"
        current={current}
        previous={previous}
        readings={now}
        prior={before}
      />
      {!individual && data.viewer.role !== "employee" && (
        <Panel
          title={filters.hierarchy ? "Direct reports" : "Logins by team"}
          caption="Select a name to see logins for that person and their team. Each login follows the employee’s assignment when they signed in."
        >
          <GridTable
            fixed
            heads={[
              "Employee or team",
              ...loginMeasures.flatMap(([, label]) =>
                previous && output
                  ? [label, previous.label + " · " + label, "Change · " + label]
                  : [label],
              ),
            ]}
            rows={branches.map(({ data: team, label }) => {
              const currentTeam = read(team, current),
                priorTeam = read(team, previous);
              return [
                label,
                ...loginMeasures.flatMap(([key]) => {
                  const value = currentTeam?.[key] ?? "—";
                  if (!previous) return [value];
                  const comparison = priorTeam?.[key] ?? "—";
                  const change = metricChange(
                    data,
                    { value: currentTeam?.[key] },
                    { value: priorTeam?.[key] },
                  );
                  if (output) return [value, comparison, change];
                  return [
                    <div className="grid gap-0.5 tabular-nums">
                      <strong>{value}</strong>
                      <small className="text-muted-foreground">
                        {previous.label} {comparison} · Change {change}
                      </small>
                    </div>,
                  ];
                }),
              ];
            })}
            empty="No direct reports match these dates and filters."
          />
        </Panel>
      )}
      {employeeList}
      {(individual || data.viewer.role === "employee") && (
        <Panel
          title="Login events"
          caption="Successful sign-ins in each selected period, newest first within each period."
        >
          <Paged
            heads={["Period", "Signed in (UTC)"]}
            rows={[
              ...(now?.loginEvents || []).map((event) => [
                "Current",
                timestamp(event.occurred_at),
              ]),
              ...(before?.loginEvents || []).map((event) => [
                previous.label,
                timestamp(event.occurred_at),
              ]),
            ]}
            empty="No sign-ins in the selected periods."
          />
        </Panel>
      )}
    </>
  );
}
