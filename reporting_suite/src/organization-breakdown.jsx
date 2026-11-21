import { ArrowUpRight, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrganizationPath, organizationLevel } from "./hierarchy";
import { metricValue, metricChange, periodReadings } from "./period-comparison";
import { GridTable, Panel } from "./shared";
import { useView } from "./view-state";

// Only measures attributable to employee assignments belong in organization columns.
const measures = new Set([
  "Approved recognitions",
  "Receiving participation",
  "Milestone awards",
  "Orders placed",
  "Order value",
  "Points balance",
  "Award spending",
  "Successful logins",
]);
function displayLabel(label) {
  return label === "Award spending" ? "Award spending (points)" : label;
}

export function OrganizationBreakdown({
  data,
  filters,
  current,
  previous,
  asOf,
  choose,
  openReport,
}) {
  const { output } = useView();
  const { nodes, children, selected } = organizationLevel(
    data.orgs,
    filters.org,
  );
  const units = children.length ? children : selected ? [selected] : [];
  const columns = units.map((org) => {
    const settings = { ...filters, org: org.org_id };
    const read = (range) =>
      new Map(
        periodReadings(data.reports, range, settings, asOf)
          .metrics.filter((m) => measures.has(m.label))
          .map((m) => [m.label, m]),
      );
    return {
      org,
      now: read(current),
      before:
        previous && previous.start >= "2026-01-01" ? read(previous) : null,
    };
  });
  const labels = [...measures].filter((label) => columns[0]?.now.has(label));
  function amounts(column, label) {
    const metric = column.now.get(label);
    const prior = column.before?.get(label);
    return [
      metricValue(data, metric),
      ...(previous
        ? [
            prior ? metricValue(data, prior) : "—",
            metricChange(data, metric, prior),
          ]
        : []),
    ];
  }
  const title = "Organization breakdown";
  if (output)
    return (
      <Panel title={title}>
        <GridTable
          fixed
          heads={[
            "Organization ID",
            "Organization",
            "Metric",
            "Current",
            ...(previous ? [previous.label, "Change"] : []),
          ]}
          rows={columns.flatMap((c) =>
            labels.map((label) => [
              c.org.org_id,
              c.org.name,
              displayLabel(label),
              ...amounts(c, label),
            ]),
          )}
        />
      </Panel>
    );
  return (
    <Panel
      title={title}
      caption={
        children.length
          ? "Select an organization to drill down, or a value to open its report."
          : "Select a value to open its report."
      }
    >
      <div className="mb-3">
        <OrganizationPath nodes={nodes} choose={choose} />
      </div>
      {columns.length ? (
        <Table aria-label={title}>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Metric</TableHead>
              {columns.map(({ org }) => (
                <TableHead scope="col" key={org.org_id}>
                  {children.length ? (
                    <button
                      className="inline-flex items-center gap-1 font-semibold hover:underline"
                      aria-label={"Drill into " + org.name}
                      onClick={() => choose(org.org_id)}
                    >
                      {org.name}
                      <ChevronRight size={14} />
                    </button>
                  ) : (
                    org.name
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {labels.map((label) => (
              <TableRow key={label}>
                <TableHead scope="row" className="font-normal">
                  {displayLabel(label)}
                </TableHead>
                {columns.map((c) => {
                  const [value, reference, delta] = amounts(c, label);
                  return (
                    <TableCell key={c.org.org_id} className="tabular-nums">
                      <button
                        className="group inline-flex items-center gap-1 font-semibold hover:underline"
                        aria-label={
                          label +
                          ", " +
                          value +
                          ". Open report for " +
                          c.org.name
                        }
                        onClick={() =>
                          openReport(c.now.get(label).tab, c.org.org_id)
                        }
                      >
                        {value}
                        <ArrowUpRight
                          size={12}
                          className="text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                        />
                      </button>
                      {previous && (
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span>
                            {previous.label} {reference}
                          </span>
                          {delta !== "—" && (
                            <span className="font-medium text-foreground">
                              Δ {delta}
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">
          No visible organizations at this level.
        </p>
      )}
    </Panel>
  );
}
