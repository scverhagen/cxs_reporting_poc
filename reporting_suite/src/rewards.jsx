import { ReportPlot } from "./period-charts";
import { BalanceTrend, Distribution } from "./charts";
import { useOption } from "./view-state";
import { Filter, Metrics, Panel, GridTable } from "./shared";
import { ordersInScope, walletInScope, day, dayMs } from "./metrics";
import {
  sum,
  fmt,
  groups,
  money,
  label,
  Detail,
  Section,
  Paged,
  Search,
  timestamp,
} from "./report-tools";

function OrderDetail({ o, data }) {
  const showValue = data.viewer.can_view_order_value;
  return (
    <Detail
      trigger={o.order_id}
      title="Order timeline"
      caption={[
        data.people[o.employee_id],
        label(o.redemption_source),
        label(o.status),
      ].join(" · ")}
    >
      <GridTable
        heads={["Submitted", "Processing", "First shipped", "Delivered"]}
        rows={[
          [
            o.submitted_at,
            o.processing_at,
            o.first_shipped_at,
            o.delivered_at,
          ].map(timestamp),
        ]}
      />
      <Section title="Redemption">
        <p className="text-sm">
          {fmt(o.points_spent)} points
          {showValue && " · " + money(data, o.value_minor)}
          {o.entitlement_id ? " · Entitlement " + o.entitlement_id : ""}
        </p>
      </Section>
      <Section title="Items">
        <GridTable
          heads={[
            "SKU",
            "Item",
            "Quantity",
            ...(showValue ? ["Unit value"] : []),
          ]}
          rows={o.items.map((i) => [
            i.sku,
            i.description,
            i.quantity,
            ...(showValue ? [money(data, i.unit_value_minor)] : []),
          ])}
        />
      </Section>
      <Section title="Shipment tracking">
        <GridTable
          heads={[
            "Carrier",
            "Tracking",
            "Item",
            "Shipped units",
            "Shipped",
            "Delivered",
          ]}
          rows={o.shipments.map((s) => [
            s.carrier,
            s.tracking_reference,
            s.item_id,
            s.quantity,
            timestamp(s.shipped_at),
            timestamp(s.delivered_at),
          ])}
          empty="No shipments recorded."
        />
      </Section>
      <Section title="Status history">
        <GridTable
          heads={["Time", "Status", "Exception", "Detail"]}
          rows={o.history.map((h) => [
            timestamp(h.occurred_at),
            label(h.status),
            h.exception_code || "—",
            h.detail || "—",
          ])}
        />
      </Section>
    </Detail>
  );
}
export function Orders({ data, tab, start, end, scope, asOf }) {
  const [source, setSource] = useOption("source", ""),
    [status, setStatus] = useOption("status", ""),
    [ageLimit, setAgeLimit] = useOption("ageLimit", "7");
  const showValue = data.viewer.can_view_order_value;
  const exceptions = tab === "exceptions";
  const age = (o) =>
    Math.floor((day(asOf) - day(o.submitted_at.slice(0, 10))) / dayMs);
  const reasons = (o) => [
    ...new Set([
      ...o.history
        .filter((h) => h.exception_code)
        .map((h) => label(h.exception_code.toLowerCase())),
      ...(["failed", "canceled"].includes(o.status) ? [label(o.status)] : []),
      ...(!["delivered", "failed", "canceled"].includes(o.status) &&
      age(o) >= Number(ageLimit)
        ? ["Open " + age(o) + " days"]
        : []),
    ]),
  ];
  const rows = ordersInScope(data, start, end, scope, source, status).filter(
    (o) => !exceptions || reasons(o).length,
  );
  const statuses = Array.from(
    new Set(data.catalog.orders.map((o) => o.status)),
  ).sort();
  const monthly = groups(rows, (o) => o.submitted_at.slice(0, 7)).sort();
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Filter
          label="Redemption source"
          value={source}
          onChange={setSource}
          options={[
            ["", "All sources"],
            ["points", "Points"],
            ["milestone", "Milestone"],
          ]}
        />
        <Filter
          label="Fulfillment status"
          value={status}
          onChange={setStatus}
          options={[
            ["", "All statuses"],
            ...statuses.map((s) => [s, label(s)]),
          ]}
        />
        {exceptions && (
          <Filter
            label="Flag open orders after"
            value={ageLimit}
            onChange={setAgeLimit}
            options={["3", "7", "14", "30"].map((v) => [v, v + " days"])}
          />
        )}
      </div>
      <Metrics
        items={
          exceptions
            ? [
                ["Flagged orders", rows.length, "Distinct orders"],
                [
                  "Failed",
                  rows.filter((o) => o.status === "failed").length,
                  "Current status",
                ],
                [
                  "Canceled",
                  rows.filter((o) => o.status === "canceled").length,
                  "Current status",
                ],
                [
                  "Open exceptions",
                  rows.filter(
                    (o) =>
                      !["canceled", "failed", "delivered"].includes(o.status),
                  ).length,
                  "Still in fulfillment",
                ],
              ]
            : [
                ["Orders", rows.length, "Distinct submitted orders"],
                [
                  "Item units",
                  sum(rows, (o) => o.item_units),
                  "Across order lines",
                ],
                [
                  "Redeemers",
                  new Set(rows.map((o) => o.employee_id)).size,
                  "Distinct employees",
                ],
                ...(showValue
                  ? [
                      [
                        "Order value",
                        money(
                          data,
                          sum(rows, (o) => o.value_minor || 0),
                        ),
                        "Gross submitted value",
                      ],
                    ]
                  : []),
              ]
        }
      />
      <ReportPlot />
      <Distribution
        title={
          exceptions ? "Flagged orders by status" : "Fulfillment status mix"
        }
        caption="Select a status to filter the order list."
        unit="Orders"
        rows={groups(rows, (o) => o.status)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([s, list]) => [label(s), list.length, s])}
        onSelect={(s) => setStatus(s === status ? "" : s)}
      />
      <Panel
        title={exceptions ? "Fulfillment investigation" : "Reward orders"}
        caption={
          "Select an order for items, tracking and status history. Status as of " +
          asOf +
          "."
        }
      >
        <Paged
          heads={[
            "Order",
            "Employee",
            "Source",
            "Submitted",
            "Status",
            ...(exceptions ? ["Exception"] : ["Units"]),
            ...(!exceptions && showValue ? ["Value"] : []),
          ]}
          rows={rows.map((o) => [
            <OrderDetail o={o} data={data} />,
            data.people[o.employee_id],
            label(o.redemption_source),
            o.submitted_at.slice(0, 10),
            label(o.status),
            ...(exceptions ? [reasons(o).join(" · ")] : [o.item_units]),
            ...(!exceptions && showValue ? [money(data, o.value_minor)] : []),
          ])}
        />
      </Panel>
      {!exceptions && (
        <Panel
          title="Monthly order activity"
          caption="Grouped by submission month"
        >
          <GridTable
            heads={[
              "Month",
              "Orders",
              "Units",
              "Redeemers",
              ...(showValue ? ["Gross value"] : []),
            ]}
            rows={monthly.map(([m, list]) => [
              m,
              list.length,
              sum(list, (o) => o.item_units),
              new Set(list.map((o) => o.employee_id)).size,
              ...(showValue
                ? [
                    money(
                      data,
                      sum(list, (o) => o.value_minor || 0),
                    ),
                  ]
                : []),
            ])}
          />
        </Panel>
      )}
    </>
  );
}

export function Wallets({ data, start, end, scope }) {
  if (data.observed_through && end > data.observed_through)
    end = data.observed_through;
  const [search, setSearch] = useOption("search", "");
  const { employees, tx } = walletInScope(data, end, scope, search);
  const byEmployee = new Map(groups(tx, (t) => t.employee_id));
  const amount = (list, ...kinds) =>
    sum(list, (t) =>
      !kinds.length || kinds.includes(t.kind) ? t.points_delta : 0,
    );
  const balances = employees
    .map((id) => ({
      id,
      list: byEmployee.get(id) || [],
      balance: amount(byEmployee.get(id) || []),
    }))
    .sort((a, b) => b.balance - a.balance);
  const awards = groups(
    tx.filter((t) => t.kind === "award"),
    (t) => t.program_id,
  );
  let running = 0;
  const history = groups(tx, (t) => t.occurred_at.slice(0, 7))
    .sort()
    .map(([month, list]) => {
      running += amount(list);
      return [
        month,
        fmt(amount(list, "award")),
        fmt(-amount(list, "redemption")),
        fmt(amount(list)),
        running,
      ];
    });
  return (
    <>
      <Search
        value={search}
        onChange={setSearch}
        placeholder="Employee name or ID"
      />
      <Metrics
        items={[
          ["Shared balance", fmt(amount(tx)), "Points as of " + end],
          ["Awarded", fmt(amount(tx, "award")), "Recognition credits"],
          ["Redeemed", fmt(-amount(tx, "redemption")), "Gross points spent"],
          ["Expired", fmt(-amount(tx, "expiry")), "Expired employee points"],
        ]}
      />
      <ReportPlot>
        <BalanceTrend
          title="Wallet balance over time"
          caption="Closing points balance for the selected employees. Use the slider to inspect a date."
          transactions={tx}
          from={start}
          through={end}
        />
      </ReportPlot>
      <Panel
        title="Employee wallets"
        caption="Highest balances first. Select an employee to review their ledger."
      >
        <Paged
          heads={[
            "Employee",
            "Balance",
            "Earned",
            "Redeemed",
            "Adjusted / refunded",
            "Expired",
            "Last redemption",
            "Last activity",
          ]}
          rows={balances.map(({ id, list, balance }) => [
            <Detail
              trigger={data.people[id]}
              title="Wallet transactions"
              caption={
                data.people[id] + " · " + fmt(balance) + " points as of " + end
              }
            >
              <Paged
                heads={[
                  "Date",
                  "Type",
                  "Points",
                  "Program",
                  "Reference",
                  "Reason",
                ]}
                rows={[...list]
                  .reverse()
                  .map((t) => [
                    timestamp(t.occurred_at),
                    label(t.kind),
                    fmt(t.points_delta),
                    data.programs[t.program_id] || "—",
                    t.order_id || t.recognition_id || t.transaction_id,
                    t.reason || "—",
                  ])}
              />
            </Detail>,
            fmt(balance),
            fmt(amount(list, "award")),
            fmt(-amount(list, "redemption")),
            fmt(amount(list, "adjustment", "award_reversal", "refund")),
            fmt(-amount(list, "expiry")),
            list
              .filter((t) => t.kind === "redemption")
              .at(-1)
              ?.occurred_at.slice(0, 10) || "—",
            list.at(-1)?.occurred_at.slice(0, 10) || "—",
          ])}
        />
      </Panel>
      <div className="report-grid">
        <Panel
          title="Balance history"
          caption="Month-end balances for the selected employee population"
        >
          <GridTable
            heads={["Month", "Awarded", "Redeemed", "Net change", "Balance"]}
            rows={history.map((row) => [...row.slice(0, -1), fmt(row.at(-1))])}
          />
        </Panel>
        <Panel
          title="Awards by program"
          caption="Credits into shared employee wallets"
        >
          <GridTable
            heads={["Program", "Points awarded"]}
            rows={awards.map(([p, list]) => [
              data.programs[p],
              fmt(amount(list)),
            ])}
          />
        </Panel>
      </div>
      <Panel
        title="Balance by department"
        caption="Employee assignment at the selected balance date. Former employees without a current assignment are shown separately."
      >
        <GridTable
          heads={[
            "Department",
            "Employees",
            "Total balance",
            "Average balance",
            "Largest balance",
          ]}
          rows={groups(balances, (b) => {
            const history = data.history.find(
              (h) =>
                h.employee_id === b.id &&
                h.valid_from <= end &&
                (!h.valid_to || end < h.valid_to),
            );
            return (
              data.orgs.find((o) => o.org_id === history?.org_id)?.name ||
              "Unassigned"
            );
          }).map(([org, group]) => {
            const balance = sum(group, (b) => b.balance);
            return [
              org,
              group.length,
              fmt(balance),
              fmt(balance / group.length),
              fmt(Math.max(...group.map((b) => b.balance))),
            ];
          })}
        />
      </Panel>
    </>
  );
}
