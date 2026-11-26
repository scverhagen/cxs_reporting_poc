import { orgAt } from "./metrics";
import { within } from "./report-tools";

export const loginMeasures = [
  ["total", "Successful logins", "Interactive sign-ins excluding one-time-use PAC"],
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
  const excluded = new Set(data.catalog.login_excluded_employees);
  for (const h of data.history) {
    if (
      !excluded.has(h.employee_id) &&
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
  for (const { employee_id, day } of data.catalog.login_exempt_days ?? []) {
    if (employees.get(employee_id)?.count === 0 && within(day, range.start, end) &&
        orgAt(data, employee_id, day, scope)) {
      employees.delete(employee_id);
    }
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
