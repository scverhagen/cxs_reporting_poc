import { fundingPeriod, fundingPoints as amount } from "./funding";
import { useContext } from "react";
import { BankBalanceTrends } from "./bank-balance-trends";
import { ComparedPlot, PeriodChart, ReportPlot } from "./period-charts";
import { Comparison } from "./charts";
import { useOption } from "./view-state";
import { Metrics, Panel, GridTable, Filter } from "./shared";
import { orgAt } from "./metrics";
import {
  sum,
  fmt,
  rate,
  money,
  within,
  groups,
  Paged,
  Detail,
  timestamp,
  Section,
  label,
} from "./report-tools";

export function Funding({ data, start, end, scope, program, asOf }) {
  const comparison = useContext(ComparedPlot);
  const c = data.catalog,
    [bank, setBank] = useOption("bank", "");
  const { banks, tx, period, awards } = fundingPeriod(
    data,
    start,
    end,
    scope,
    program,
    bank,
  );
  const names = Object.fromEntries(banks.map((b) => [b.bank_id, b.name]));
  const commitments = c.commitments.filter((r) => !bank || bank === r.bank_id);
  let running = amount(tx.filter((t) => t.occurred_at.slice(0, 10) < start));
  const monthly = groups(period, (t) => t.occurred_at.slice(0, 7))
    .sort()
    .map(([m, list]) => {
      running += amount(list);
      return [
        m,
        fmt(amount(list, "opening", "top_up")),
        fmt(-amount(list, "award")),
        fmt(amount(list, "adjustment", "reversal")),
        fmt(running),
      ];
    });
  const budgetRows = banks.map((b) => {
    const { inPeriod, opening, funds, spent, adjust, remaining, available } = b;
    const bankPrograms = c.bank_programs
      .filter((bp) => bp.bank_id === b.bank_id)
      .map((bp) => data.programs[bp.program_id]);
    return [
      <Detail
        trigger={b.name}
        title="Funding ledger"
        caption={bankPrograms.join(" · ") || "No assigned program"}
      >
        <Paged
          heads={[
            "Date",
            "Action",
            "Points",
            "Program",
            "Sender",
            "Recognition / reason",
          ]}
          rows={[...inPeriod]
            .reverse()
            .map((t) => [
              timestamp(t.occurred_at),
              label(t.kind),
              fmt(t.points_delta),
              data.programs[t.program_id] || "—",
              data.people[t.sender_id] || "—",
              t.recognition_id || t.reason || "—",
            ])}
        />
      </Detail>,
      fmt(opening),
      fmt(funds),
      fmt(spent),
      fmt(adjust),
      fmt(remaining),
      rate(spent, available),
    ];
  });
  const spend = groups(awards, (t) =>
    JSON.stringify([
      t.program_id,
      t.bank_id,
      t.sender_id,
      t.occurred_at.slice(0, 7),
    ]),
  ).map(([k, list]) => {
    const [p, b, s, m] = JSON.parse(k);
    return [
      m,
      data.programs[p],
      names[b],
      data.people[s],
      new Set(list.map((t) => t.recognition_id)).size,
      fmt(-amount(list)),
    ];
  });
  return (
    <>
      <Filter
        label="Funding bank"
        value={bank}
        onChange={setBank}
        options={[
          ["", "All banks"],
          ...c.banks.map((b) => [b.bank_id, b.name]),
        ]}
      />
      <Metrics
        items={[
          [
            "Bank balance",
            fmt(amount(tx)),
            "Whole selected banks at period end",
          ],
          ["Top-ups", fmt(amount(period, "top_up")), "During period"],
          [
            "Awards funded",
            fmt(-amount(period, "award")),
            "Whole-bank debits during period",
          ],
          [
            "Potential commitments",
            fmt(sum(commitments, (r) => r.potential_points)),
            "Pending / submitted at data snapshot",
          ],
        ]}
      />
      <BankBalanceTrends
        current={{ start, end }}
        previous={comparison?.previous}
        banks={banks}
        priorBanks={comparison?.prior?.banks}
        asOf={asOf}
      />
      <ReportPlot>
        <PeriodChart
          tab="funding"
          current={{ start, end }}
          readings={{ fundingAwards: awards, asOf }}
        />
      </ReportPlot>
      <Comparison
        title="Award spending by program"
        caption="Points funded in the selected period, bank, and sender organization."
        series={["Awarded points"]}
        rows={groups(awards, (t) => t.program_id)
          .map(([id, list]) => [data.programs[id], -amount(list)])
          .sort((a, b) => b[1] - a[1])}
      />
      <Panel
        title="Bank utilization"
        caption="Whole-bank balances. Select a bank to inspect its period ledger."
      >
        <GridTable
          heads={[
            "Bank",
            "Opening",
            "Top-ups",
            "Awards",
            "Corrections",
            "Remaining",
            "Utilization",
          ]}
          rows={budgetRows}
        />
      </Panel>
      <Panel
        title="Bank balance history"
        caption="Posted funding and spending by month across selected banks."
      >
        <GridTable
          heads={[
            "Month",
            "Opening / top-ups",
            "Award debits",
            "Corrections",
            "Closing balance",
          ]}
          rows={monthly}
        />
      </Panel>
      <Panel
        title="Program spending"
        caption="Program and sender-organization filters apply to this breakdown. Each award uses its actual funding bank."
      >
        <Paged
          heads={[
            "Month",
            "Program",
            "Bank",
            "Sender",
            "Events",
            "Awarded points",
          ]}
          rows={spend}
        />
      </Panel>
    </>
  );
}
export function Finance({ data, start, end, scope, program }) {
  const rows = data.catalog.allocations.filter(
    (r) =>
      within(r.occurred_at, start, end) &&
      (!program || r.program_id === program) &&
      orgAt(data, r.employee_id, r.occurred_at.slice(0, 10), scope),
  );
  const total = (k) => sum(rows, (r) => r[k]);
  const orders = groups(rows, (r) => r.order_id);
  return (
    <>
      <Metrics
        items={[
          [
            "Allocated points",
            fmt(total("allocated_points")),
            "Source-calculated lot allocations",
          ],
          [
            "Funding cost",
            money(data, total("funding_cost_minor")),
            "Allocated funding cost",
          ],
          [
            "Liability released",
            money(data, total("liability_released_minor")),
            "Source-calculated value",
          ],
          [
            "Taxable benefit",
            money(data, total("taxable_value_minor")),
            "Platform-supplied taxable value",
          ],
        ]}
      />
      <Comparison
        title="Financial measures by award program"
        caption="Platform-calculated dollar amounts for the selected redemptions."
        series={["Funding cost", "Liability released", "Taxable benefit"]}
        format={(n) => money(data, n)}
        rows={groups(rows, (r) => r.program_id).map(([id, list]) => [
          data.programs[id],
          ...[
            "funding_cost_minor",
            "liability_released_minor",
            "taxable_value_minor",
          ].map((key) => sum(list, (r) => r[key])),
        ])}
      />
      <Panel
        title="FIFO and taxable allocations"
        caption="Restricted platform extract. Select an allocation to reconcile its source transactions."
      >
        <GridTable
          heads={[
            "Allocation",
            "Employee",
            "Award program",
            "Points",
            "Funding cost",
            "Liability released",
            "Taxable value",
          ]}
          rows={rows.map((r) => [
            <Detail
              trigger={r.allocation_id}
              title="Allocation source records"
              caption={r.source_calculation_id}
            >
              <GridTable
                heads={["Source", "Transaction", "Reference", "Date"]}
                rows={[
                  [
                    "Award",
                    r.award_transaction_id,
                    r.recognition_id,
                    timestamp(r.awarded_at),
                  ],
                  [
                    "Redemption",
                    r.redemption_transaction_id,
                    r.order_id,
                    timestamp(r.occurred_at),
                  ],
                ]}
              />
              <Section title="Jurisdiction">
                <p>
                  {r.tax_jurisdiction} · {data.currency}
                </p>
              </Section>
            </Detail>,
            data.people[r.employee_id],
            data.programs[r.program_id],
            r.allocated_points,
            money(data, r.funding_cost_minor),
            money(data, r.liability_released_minor),
            money(data, r.taxable_value_minor),
          ])}
        />
      </Panel>
      <Panel
        title="Redemption reconciliation"
        caption="Selected allocations are grouped by redemption. Retail value and fulfillment cost are reported once per order."
      >
        <GridTable
          heads={[
            "Order",
            "Allocated points",
            "Order points",
            "Retail value",
            "Fulfillment cost",
          ]}
          rows={orders.map(([id, list]) => [
            id,
            sum(list, (r) => r.allocated_points),
            list[0].points_spent,
            money(data, list[0].value_minor),
            money(data, list[0].fulfillment_cost_minor),
          ])}
        />
      </Panel>
    </>
  );
}
