import { Fragment } from "react";
import {
  alignPeriodDays,
  chartTable,
  dailyLedgerBalances,
  PeriodPlot,
} from "./period-charts";
import { GridTable, Panel } from "./shared";
import { useView } from "./view-state";

export function BankBalanceTrends({
  current,
  previous,
  banks,
  priorBanks,
  asOf,
  renderChart,
}) {
  const { output } = useView();
  if (!banks.length) return null;
  const title = "Budget balance over time";
  const unit = "Closing balance (points)";
  const charts = banks.map((bank) => {
    const before = priorBanks?.find((b) => b.bank_id === bank.bank_id);
    const rows = alignPeriodDays(
      dailyLedgerBalances(current, bank.ledger, asOf),
      previous ? dailyLedgerBalances(previous, before?.ledger, asOf) : [],
    );
    return { bank, unit, rows, balance: true, label: previous?.label };
  });
  if (output) {
    const tables = charts.map(chartTable);
    return (
      <Panel title={title}>
        <GridTable
          fixed
          heads={["Funding bank", "Bank ID", ...tables[0].heads]}
          rows={tables.flatMap((table, i) =>
            table.rows.map((row) => [banks[i].name, banks[i].bank_id, ...row]),
          )}
        />
      </Panel>
    );
  }
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="breakdown-plots">
        {charts.map(({ bank, ...model }) => {
          const plot = (
            <PeriodPlot
              {...model}
              title={bank.name}
              caption="Daily closing balance in points"
              preview={!!renderChart}
            />
          );
          return (
            <Fragment key={bank.bank_id}>
              {renderChart ? renderChart(bank, plot) : plot}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
