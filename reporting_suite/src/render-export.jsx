import { hasTeamPages } from "./team-route";
import { TeamReport } from "./team-report";
import { HierarchyMetadata } from "./hierarchy";
import { RollingDates } from "./rolling-dates";
import { EmployeeAttributes, assignmentScope } from "./employee-attributes";
// Render the same report tree as the browser, including all pages of every table.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ViewState, defaults, orgScope } from "./view-state";
import { CatalogReport, catalog } from "./catalog";
import { Recognition } from "./recognition";
import { recognitionPeriod } from "./metrics";
import { Milestones } from "./milestones";
import { ReportComparison } from "./period-comparison";
import { Overview } from "./overview";
const {
  data: source,
  asOf,
  view,
  output,
  runDay,
} = JSON.parse(readFileSync(0, "utf8"));
const { tab, tag, options } = view;
const filters = { ...defaults, ...view.filters, runDay };
const data = assignmentScope(source, filters);
const scope = orgScope(filters.org, data.orgs);
const Component = hasTeamPages(tab)
  ? TeamReport
  : tab === "overview"
    ? Overview
    : Object.hasOwn(catalog, tab)
      ? CatalogReport
      : ["upcoming", "awards", "nonresponders"].includes(tab)
        ? Milestones
        : Recognition;
const isRecognition = Component === Recognition;
const period = isRecognition ? recognitionPeriod(filters, asOf) : {};
const eligibilityRange =
  filters.eligibilityPeriod && filters.eligibilityPeriod !== "any"
    ? recognitionPeriod({ ...filters, period: filters.eligibilityPeriod }, asOf)
    : null;
const filterLabels =
  Component === CatalogReport ||
  Component === Overview ||
  Component === TeamReport
    ? {}
    : {
        Organization:
          data.orgs.find((o) => o.org_id === filters.org)?.name ||
          "All organizations",
        ...(isRecognition
          ? {
              From: period.start,
              Through: period.end,
              Program: data.programs[filters.program] || "All programs",
              "Recognition tag": tag?.label,
              "Detail search": options.search,
            }
          : {
              ...(eligibilityRange
                ? {
                    "Eligible from": eligibilityRange.start,
                    "Eligible through": eligibilityRange.end,
                  }
                : {}),
              Program:
                data.milestone_programs[filters.mp] || "All milestone programs",
              "Milestone type": filters.type || "All types",
              "Horizon (days)": tab === "upcoming" && filters.horizon,
              "Outstanding age":
                tab === "nonresponders" && (filters.age || "All ages"),
            }),
      };
const report = (
  <Component
    page={options}
    {...{ data, source, tab, filters, asOf, scope, tag }}
  />
);
const tree = (
  <ViewState.Provider value={{ options, output }}>
    <RollingDates {...{ tab, filters, options, asOf }} />
    <HierarchyMetadata
      data={source}
      filters={filters}
      org={Component === CatalogReport ? options.org : filters.org}
    />
    <EmployeeAttributes data={source} filters={filters} />
    {Object.entries(filterLabels)
      .filter(([, v]) => v)
      .map(([k, v]) => (
        <span key={k} data-filter={k} data-value={v} />
      ))}
    {isRecognition || Component === Milestones ? (
      <ReportComparison {...{ tab, data, filters, asOf, tag }}>
        {report}
      </ReportComparison>
    ) : (
      report
    )}
  </ViewState.Provider>
);
process.stdout.write(renderToStaticMarkup(tree));
