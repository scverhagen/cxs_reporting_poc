import { orgAt } from "./metrics";
import { within } from "./report-tools";

export const loginMeasures = [
  ["total", "Successful logins", "Completed interactive sign-ins"],
  ["users", "Users logged in", "Distinct employees with a sign-in"],
  [
    "inactive",
    "Users without a login",
    "Assigned in the period with no sign-in",
  ],
];

export function loginReading(data, range, scope) {
  if (
    !range ||
    range.start < "2026-01-01" ||
    range.start > data.observed_through
  )
    return null;
  const end =
    range.end < data.observed_through ? range.end : data.observed_through;
  const employees = new Map();
  for (const h of data.history) {
    if (
      h.valid_from <= end &&
      (!h.valid_to || h.valid_to > range.start) &&
      (!scope || scope.has(h.org_id))
    ) {
      employees.set(h.employee_id, { count: 0, last: null });
    }
  }
  const events = data.catalog.logins.filter(
    (e) =>
      within(e.occurred_at, range.start, end) &&
      employees.has(e.employee_id) &&
      orgAt(data, e.employee_id, e.occurred_at.slice(0, 10), scope),
  );
  for (const event of events) {
    const employee = employees.get(event.employee_id);
    employee.count++;
    if (!employee.last || event.occurred_at > employee.last)
      employee.last = event.occurred_at;
  }
  const users = [...employees.values()].filter((e) => e.count > 0).length;
  return {
    loginEvents: events,
    asOf: data.observed_through,
    employees,
    total: events.length,
    users,
    inactive: employees.size - users,
  };
}
