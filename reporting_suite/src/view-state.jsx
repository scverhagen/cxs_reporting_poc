import { createContext, useContext } from "react";

export const ViewState = createContext({ options: {} });
export const useView = () => useContext(ViewState);
export function useOption(key, fallback) {
  const { options, setOptions } = useView();
  return [
    options[key] ?? fallback,
    (value) => setOptions((old) => ({ ...old, [key]: value })),
  ];
}

export const rollingPeriods = [
  ["last7", "Last 7 days"],
  ["last30", "Last 30 days"],
  ["last90", "Last 90 days"],
];

export const periods = [
  ["2026-10", "October 2026"],
  ["2026-11", "November to date"],
  ["2026-09", "September 2026"],
  ["all", "Year to date"],
  ...rollingPeriods,
  ["custom", "Custom dates"],
];
export const defaults = {
  compare: "off",
  comparisonStart: "",
  comparisonEnd: "",
  eligibilityPeriod: "any",
  period: "2026-10",
  start: "2026-10-01",
  end: "2026-10-31",
  program: "",
  org: "",
  mp: "",
  type: "",
  horizon: "30",
  age: "",
};
export function orgScope(org, orgs) {
  if (!org) return null;
  const scope = new Set([org]);
  for (let i = 0; i < orgs.length; i++)
    for (const row of orgs)
      if (scope.has(row.parent_org_id)) scope.add(row.org_id);
  return scope;
}
