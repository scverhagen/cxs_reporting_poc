import { orgAt } from "./metrics";

export function fundingPoints(rows, ...kinds) {
  return rows.reduce(
    (total, t) =>
      total + (!kinds.length || kinds.includes(t.kind) ? t.points_delta : 0),
    0,
  );
}

export function fundingPeriod(data, start, end, scope, program, bank) {
  const catalog = data.catalog;
  const tx = catalog.funding.filter(
    (t) => (!bank || t.bank_id === bank) && t.occurred_at.slice(0, 10) <= end,
  );
  const period = tx.filter((t) => t.occurred_at.slice(0, 10) >= start);
  const awards = period.filter(
    (t) =>
      t.kind === "award" &&
      (!program || program === t.program_id) &&
      orgAt(data, t.sender_id, t.occurred_at.slice(0, 10), scope),
  );
  // A shared bank has one balance. Sender and program filters apply to spend only.
  const banks = catalog.banks
    .filter((b) => !bank || b.bank_id === bank)
    .map((b) => {
      const ledger = tx.filter((t) => t.bank_id === b.bank_id);
      const inPeriod = period.filter((t) => t.bank_id === b.bank_id);
      const remaining = fundingPoints(ledger);
      const spent = -fundingPoints(inPeriod, "award");
      const funds = fundingPoints(inPeriod, "top_up");
      const adjust = fundingPoints(inPeriod, "adjustment", "reversal");
      const available = remaining + spent;
      return {
        ...b,
        ledger,
        inPeriod,
        remaining,
        spent,
        funds,
        adjust,
        opening: available - funds - adjust,
        available,
        scopedSpend: -fundingPoints(
          awards.filter((t) => t.bank_id === b.bank_id),
        ),
      };
    });
  return { banks, tx, period, awards };
}
