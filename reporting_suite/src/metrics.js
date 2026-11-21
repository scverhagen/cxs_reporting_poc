export const dayMs = 86400000;
export const day = (d) => new Date(d + "T00:00:00Z");
export const iso = (d) => d.toISOString().slice(0, 10);
export const shortDate = (d) =>
  day(d.slice(0, 10)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
export function tally(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
export function milestoneDate(value) {
  if (!value) return "—";
  return day(value.slice(0, 10)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function upcomingIn(rows, horizon, asOf) {
  const end =
    horizon === "all"
      ? "9999-12-31"
      : iso(new Date(+day(asOf) + Number(horizon) * dayMs));
  return rows.filter(
    (row) => row.entitlement_state === "upcoming" && row.eligible_on <= end,
  );
}

// Both series count events in the same six UTC calendar months. The last
// month stops at the snapshot date, including for organizational drill-downs.
export function awardSeries(rows, asOf) {
  const last = day(asOf);
  const months = Array.from(
    { length: 6 },
    (_, index) =>
      new Date(
        Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - 5 + index, 1),
      ),
  );
  const series = ["eligible_on", "redeemed_at"].map((field) =>
    months.map((month) => {
      const prefix = iso(month).slice(0, 7);
      return rows.filter(
        (row) =>
          row[field]?.startsWith(prefix) && row[field].slice(0, 10) <= asOf,
      ).length;
    }),
  );
  return { months, series };
}
export function awardTrend(rows, asOf) {
  const { months, series } = awardSeries(rows, asOf);
  const top = Math.max(2, Math.ceil(Math.max(...series.flat()) / 2) * 2);
  const x = (index) => 32 + index * 82;
  const y = (value) => 116 - (value * 96) / top;
  const grid = [0, top / 2, top]
    .map(
      (value) =>
        `<path d="M32 ${y(value)}H442" stroke="#ededed"/><text x="18" y="${y(value) + 4}" text-anchor="end">${value}</text>`,
    )
    .join("");
  const lines = series
    .map((values, index) => {
      const path = values
        .map((value, i) => (i ? "L" : "M") + x(i) + " " + y(value))
        .join(" ");
      const color = index ? "#1c8873" : "#3185f5";
      const area = index
        ? ""
        : `<path d="${path} V116 H32 Z" fill="url(#eligibleFill)"/>`;
      const dots = values
        .map(
          (value, i) =>
            `<circle cx="${x(i)}" cy="${y(value)}" r="3" fill="white" stroke="${color}" stroke-width="2"><title>${iso(months[i]).slice(0, 7)} · ${index ? "Redeemed" : "Eligible"}: ${value}</title></circle>`,
        )
        .join("");
      return (
        area +
        `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>` +
        dots
      );
    })
    .join("");
  const labels = months
    .map(
      (month, i) =>
        `<text x="${x(i)}" y="140" text-anchor="middle">${month.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</text>`,
    )
    .join("");
  return `<div class="trend-legend"><span>Newly eligible</span><span>Redeemed</span></div>
    <svg class="award-trend" viewBox="0 0 467 150" role="img" aria-label="Monthly newly eligible awards: ${series[0].join(", ")}. Monthly redemptions: ${series[1].join(", ")}.">
    <defs><linearGradient id="eligibleFill" x1="0" y1="0" x2="0%" y2="100%"><stop stop-color="#368ef7" stop-opacity=".18"/><stop offset="1" stop-color="#368ef7" stop-opacity=".02"/></linearGradient></defs>
    ${grid}${lines}${labels}</svg>`;
}

export function measure(
  data,
  events,
  start,
  end,
  scope,
  program,
  direction,
  onParticipant,
) {
  if (data.observed_through && end > data.observed_through)
    end = data.observed_through;
  if (end < start) return { active: 0, total: 0, rate: "—" };
  const flag = direction === "send" ? "can_send" : "can_receive",
    eligible = new Set(),
    participants = new Set();
  const intervals = data.eligibility.filter(
    (e) =>
      (!program || e.program_id === program) &&
      e[flag] &&
      e.valid_from <= end &&
      (!e.valid_to || e.valid_to > start),
  );
  for (const e of intervals) {
    const overlaps = data.history.some(
      (h) =>
        h.employee_id === e.employee_id &&
        (!scope || scope.has(h.org_id)) &&
        [start, e.valid_from, h.valid_from].sort().at(-1) <
          [
            iso(new Date(+day(end) + dayMs)),
            e.valid_to || "9999",
            h.valid_to || "9999",
          ].sort()[0],
    );
    if (overlaps) eligible.add(e.employee_id);
  }
  for (const e of events) {
    if (program && e.program !== program) continue;
    const date = e.at.slice(0, 10);
    for (const id of direction === "send" ? [e.sender] : e.recipients) {
      if (
        eligible.has(id) &&
        orgAt(data, id, date, scope) &&
        intervals.some(
          (i) =>
            i.employee_id === id &&
            i.program_id === e.program &&
            i.valid_from <= date &&
            (!i.valid_to || i.valid_to > date),
        )
      ) {
        participants.add(id);
        onParticipant?.(e, id);
      }
    }
  }
  const active = participants.size,
    total = eligible.size;
  return {
    active,
    total,
    rate: total
      ? ((active * 100) / total).toLocaleString("en-US", {
          maximumFractionDigits: 1,
        }) + "%"
      : "—",
  };
}
export function orgAt(data, id, date, scope) {
  return (
    (!scope && !data.assignmentFiltered) ||
    data.history.some(
      (h) =>
        h.employee_id === id &&
        (!scope || scope.has(h.org_id)) &&
        h.valid_from <= date &&
        (!h.valid_to || date < h.valid_to),
    )
  );
}

export const rollingDays = { last7: 7, last30: 30, last90: 90 };
export function selectedRollingPeriod(tab, filters, options) {
  if (["awards", "upcoming", "nonresponders"].includes(tab))
    return filters.eligibilityPeriod;
  if (
    [
      "activity",
      "participation",
      "categories",
      "performance",
      "leaders",
      "investigation",
      "logins",
      "overview",
      "teams",
    ].includes(tab)
  )
    return filters.period;
  return options.dateMode;
}
export function rollingRange(period, runDay = iso(new Date())) {
  const days = rollingDays[period];
  return {
    start: iso(new Date(+day(runDay) - (days - 1) * dayMs)),
    end: runDay,
  };
}
export function recognitionPeriod(filters, asOf) {
  const { period } = filters;
  if (rollingDays[period]) return rollingRange(period, filters.runDay);
  let start = period + "-01",
    end;
  if (period === "all") {
    start = asOf.slice(0, 4) + "-01-01";
    end = asOf;
  } else if (period === "custom") {
    start = filters.start;
    end = filters.end;
  } else {
    const next = day(start);
    next.setUTCMonth(next.getUTCMonth() + 1);
    end = iso(new Date(+next - dayMs));
    if (end > asOf) end = asOf;
  }
  return { start, end };
}

export function recognitionEvents(
  data,
  tab,
  start,
  end,
  scope,
  program = "",
  tag = null,
) {
  return data.events.filter((e) => {
    const d = e.at.slice(0, 10);
    return (
      d >= start &&
      d <= end &&
      (!program || program === e.program) &&
      (tab === "participation" || orgAt(data, e.sender, d, scope)) &&
      (!tag || tab !== "activity" || e[tag.kind].includes(tag.label))
    );
  });
}

export function milestoneRows(data, filters, asOf, scope) {
  const range =
    filters.eligibilityPeriod && filters.eligibilityPeriod !== "any"
      ? recognitionPeriod(
          { ...filters, period: filters.eligibilityPeriod },
          asOf,
        )
      : null;
  return data.milestones
    .filter(
      (r) =>
        (!range ||
          (r.eligible_on >= range.start && r.eligible_on <= range.end)) &&
        (!filters.type || r.milestone_type === filters.type) &&
        (!filters.mp || r.program_id === filters.mp),
    )
    .map((r) => {
      const date = r.eligible_on < asOf ? r.eligible_on : asOf;
      const h = data.history.find(
        (h) =>
          h.employee_id === r.employee_id &&
          h.valid_from <= date &&
          (!h.valid_to || date < h.valid_to),
      );
      return { ...r, org: h?.org_id };
    })
    .filter(
      (r) =>
        (!data.assignmentFiltered || r.org) && (!scope || scope.has(r.org)),
    );
}

export function walletInScope(data, end, scope, search = "") {
  const employees = Object.keys(data.people).filter(
    (id) =>
      data.history.some((h) => h.employee_id === id && h.valid_from <= end) &&
      orgAt(data, id, end, scope) &&
      [id, data.people[id]]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
  );
  const ids = new Set(employees);
  const tx = data.catalog.wallet.filter(
    (t) => ids.has(t.employee_id) && t.occurred_at.slice(0, 10) <= end,
  );
  return { employees, tx };
}
export function ordersInScope(
  data,
  start,
  end,
  scope,
  source = "",
  status = "",
) {
  return data.catalog.orders.filter((o) => {
    const date = o.submitted_at.slice(0, 10);
    return (
      date >= start &&
      date <= end &&
      orgAt(data, o.employee_id, date, scope) &&
      (!source || o.redemption_source === source) &&
      (!status || o.status === status)
    );
  });
}

// Named months compare to the preceding calendar month, including like-for-like
// month-to-date windows. Custom dates use the immediately preceding span.
export function previousPeriod({ start, end }, period, asOf) {
  const first = +day(start);
  const last = +day(end);
  const previousEnd = iso(new Date(first - dayMs));
  if (
    period === "all" &&
    start === asOf.slice(0, 4) + "-01-01" &&
    end === asOf
  ) {
    const lastYear = Number(asOf.slice(0, 4)) - 1;
    return { start: lastYear + "-01-01", end: lastYear + asOf.slice(4) };
  }
  if (
    /^\d{4}-\d{2}$/.test(period) &&
    start === period + "-01" &&
    end === recognitionPeriod({ period }, asOf).end
  ) {
    const month = previousEnd.slice(0, 7);
    const completeMonth = new Date(last + dayMs).getUTCDate() === 1;
    const matchingDay = [previousEnd, month + end.slice(7)].sort()[0];
    return {
      start: month + "-01",
      end: completeMonth ? previousEnd : matchingDay,
    };
  }
  const duration = last - first + dayMs;
  return { start: iso(new Date(first - duration)), end: previousEnd };
}

export function reportRange(tab, filters, options, asOf) {
  if (rollingDays[options.dateMode])
    return rollingRange(options.dateMode, filters.runDay);
  if (["orders", "wallets", "funding"].includes(tab))
    return { start: options.start ?? "2026-01-01", end: options.end ?? asOf };
  const period = tab === "awards" ? filters.eligibilityPeriod : filters.period;
  return period === "any"
    ? null
    : recognitionPeriod({ ...filters, period }, asOf);
}

// Each period is inclusive. Custom windows may overlap or appear in either order.
export function comparisonRange(
  current,
  filters,
  asOf,
  period = filters.period,
) {
  if (filters.compare === "previous")
    return { ...previousPeriod(current, period, asOf), label: "Previous" };
  if (filters.compare === "custom") {
    const { comparisonStart: start, comparisonEnd: end } = filters;
    if (start && end && start >= "2026-01-01" && start <= end && end <= asOf)
      return { start, end, label: "Comparison" };
  }
  return null;
}
