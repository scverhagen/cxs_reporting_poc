import { rollingDays, rollingRange } from "./metrics";
import { useOption, useView, orgScope, rollingPeriods } from "./view-state";
import {
  ChartColumnIncreasing,
  LogIn,
  Trophy,
  Wallet,
  Package,
  Truck,
  Landmark,
  ClipboardList,
  Receipt,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Filter } from "./shared";
import { CompareFilter, ReportComparison } from "./period-comparison";
import { DateField } from "./report-tools";
import { Orders, Wallets } from "./rewards";
import { Finance, Funding } from "./financial";

export const catalog = {
  logins: [
    "User logins",
    "See who signed in, how often, and when they last logged in during the selected period.",
    LogIn,
    "U1",
    "User activity",
  ],
  performance: [
    "Program performance",
    "Compare program reach, frequency, and participation across eligible populations.",
    ChartColumnIncreasing,
    "R3",
    "Recognition",
  ],
  leaders: [
    "Recognition leaderboards",
    "Compare recognition sent and received across teams, departments, and employees.",
    Trophy,
    "R4",
    "Recognition",
  ],
  investigation: [
    "Approval history",
    "Trace recognition requests from submission through approval, issuance, and notification.",
    ClipboardList,
    "I1",
    "Recognition",
  ],
  wallets: [
    "Employee points",
    "Review shared employee balances and trace credits, spending, and corrections.",
    Wallet,
    "P1",
    "Rewards",
  ],
  orders: [
    "Order activity",
    "Follow points and milestone redemptions through fulfillment.",
    Package,
    "O1",
    "Rewards",
  ],
  exceptions: [
    "Fulfillment exceptions",
    "Investigate aging orders, supplier delays, failures, and cancellations.",
    Truck,
    "O2",
    "Rewards",
  ],
  funding: [
    "Funding budgets",
    "Reconcile bank balances and compare spending across programs.",
    Landmark,
    "B1",
    "Finance",
  ],
  financial: [
    "Taxable benefits",
    "Reconcile platform-calculated FIFO allocations and taxable benefits.",
    Receipt,
    "F1",
    "Finance",
  ],
};
export function CatalogReport({
  tab,
  data,
  asOf,
  filters,
  setFilters,
  renderFilters = (controls) => controls,
}) {
  const defaultStart = "2026-01-01";
  const [fixedStart, setStart] = useOption("start", defaultStart),
    [fixedEnd, setEnd] = useOption("end", asOf),
    [org, setOrg] = useOption("org", ""),
    [program, setProgram] = useOption("program", "");
  const [dateMode, setDateMode] = useOption("dateMode", "custom");
  const rolling = rollingDays[dateMode];
  const { start, end } = rolling
    ? rollingRange(dateMode, filters.runDay)
    : { start: fixedStart, end: fixedEnd };
  const scope = orgScope(org, data.orgs);
  const { output } = useView();
  const Report = {
    wallets: Wallets,
    orders: Orders,
    exceptions: Orders,
    funding: Funding,
    financial: Finance,
  }[tab];
  const comparable = ["wallets", "orders", "funding"].includes(tab);
  const dated = tab !== "wallets";
  const basis = {
    wallets: "Wallet balance date",
    orders: "Order submission date",
    exceptions: "Order submission date",
    funding: "Ledger posting date",
    financial: "Redemption date",
  }[tab];
  const valid =
    end &&
    (rolling || end <= asOf) &&
    end >= "2026-01-01" &&
    start &&
    start >= "2026-01-01" &&
    start <= end;
  return (
    <>
      {renderFilters(
        <div className="flex flex-wrap items-end gap-2.5">
          <Filter
            label="Reporting period"
            value={dateMode}
            options={[["custom", "Fixed dates"], ...rollingPeriods]}
            onChange={setDateMode}
          />
          {(!rolling || output) && (
            <>
              <DateField
                name={dated ? "From" : "Trend from"}
                value={start}
                onChange={setStart}
                max={asOf}
              />
              <DateField
                name={dated ? "Through" : "Balance as of"}
                value={end}
                onChange={setEnd}
                max={asOf}
              />
            </>
          )}
          {!["wallets", "orders", "exceptions"].includes(tab) && (
            <Filter
              label={tab === "funding" ? "Spending program" : "Program"}
              value={program}
              onChange={setProgram}
              options={[["", "All programs"], ...Object.entries(data.programs)]}
            />
          )}
          <Filter
            label={tab === "funding" ? "Sender organization" : "Organization"}
            value={org}
            onChange={setOrg}
            options={[
              [
                "",
                data.viewer.role === "admin"
                  ? "All organizations"
                  : "All visible organizations",
              ],
              ...data.orgs
                .filter((o) => o.org_id !== "root")
                .map((o) => [
                  o.org_id,
                  (!o.parent_org_id || o.parent_org_id === "root" ? "" : "　") +
                    o.name,
                ]),
            ]}
          />
          {comparable && <CompareFilter {...{ filters, setFilters, asOf }} />}
        </div>,
      )}
      <Separator />
      {valid ? (
        <ReportComparison {...{ data, tab, filters, asOf }}>
          <Report
            {...{ tab, data, start, end, scope, program, setProgram, asOf }}
          />
        </ReportComparison>
      ) : (
        <p role="alert">
          Choose dates between January 1, 2026 and {asOf}, with the start on or before
          the end.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {basis} · UTC · Data as of {asOf} at 16:00 UTC
      </p>
    </>
  );
}
