import { Filter } from "./shared";
import { useView } from "./view-state";

const prefix = "attribute:";
const missingPrefix = "unassigned:";
const isAttribute = (key) =>
  key.startsWith(prefix) || key.startsWith(missingPrefix);
const fieldName = (key) => key.slice(key.indexOf(":") + 1);
export function withAttribute(filters, key, value) {
  const next = { ...filters };
  delete next[prefix + key];
  delete next[missingPrefix + key];
  if (value == null) next[missingPrefix + key] = "1";
  else if (value !== "") next[prefix + key] = value;
  return next;
}
export function attributeKeys(reports) {
  return [...new Set(reports.flatMap((r) => r.attribute_keys))].sort();
}
export const attributeLabel = (key) =>
  key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const selected = (filters) =>
  Object.entries(filters).filter(([k, v]) => isAttribute(k) && v);
export const clearAttributes = (filters) =>
  Object.fromEntries(
    Object.entries(filters).filter(([key]) => !isAttribute(key)),
  );

export function assignmentScope(data, filters) {
  const entries = selected(filters);
  const path = filters.hierarchy;
  if (!data || (!entries.length && !path)) return data;
  if (data.reports)
    return {
      ...data,
      reports: Object.fromEntries(
        Object.entries(data.reports).map(([tab, report]) => [
          tab,
          assignmentScope(report, filters),
        ]),
      ),
    };
  return {
    ...data,
    assignmentFiltered: true,
    history: data.history.filter(
      (h) =>
        (!path ||
          h.hierarchy === path ||
          (filters.hierarchyMode !== "individual" &&
            h.hierarchy.startsWith(path + "/"))) &&
        entries.every(([k, v]) =>
          k.startsWith(missingPrefix)
            ? !h.attributes[fieldName(k)]
            : h.attributes[fieldName(k)] === v,
        ),
    ),
  };
}

export function EmployeeAttributes({ data, filters, setFilters }) {
  const { output } = useView();
  const reports = data.reports ? Object.values(data.reports) : [data];
  const keys = attributeKeys(reports);
  const active = selected(filters);
  if (output)
    return active
      .filter(([key]) => keys.includes(fieldName(key)))
      .map(([key, v]) => (
        <span
          key={key}
          data-filter={attributeLabel(fieldName(key))}
          data-value={key.startsWith(missingPrefix) ? "Unassigned" : v}
        />
      ));
  if (!keys.length && !active.length) return null;
  return (
    <details className="border-t pt-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Employee attributes
        {active.length
          ? " · " +
            active
              .filter(([k]) => keys.includes(fieldName(k)))
              .map(
                ([k, v]) =>
                  attributeLabel(fieldName(k)) +
                  " = " +
                  (k.startsWith(missingPrefix) ? "Unassigned" : v),
              )
              .join(", ")
          : ""}
      </summary>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {keys.map((key) => {
          const field = prefix + key;
          const values = [
            ...new Set(
              reports
                .flatMap((r) => r.history.map((h) => h.attributes[key]))
                .filter(Boolean),
            ),
          ].sort();
          const hasMissing =
            !!filters[missingPrefix + key] ||
            reports.some((r) => r.history.some((h) => !h.attributes[key]));
          let missingOption = "__unassigned__";
          while (values.includes(missingOption)) missingOption += "_";
          return (
            <Filter
              key={key}
              label={attributeLabel(key)}
              value={
                filters[missingPrefix + key]
                  ? missingOption
                  : filters[field] || ""
              }
              options={[
                ["", "All values"],
                ...values.map((v) => [v, v]),
                ...(hasMissing ? [[missingOption, "Unassigned"]] : []),
              ]}
              onChange={(value) =>
                setFilters((f) =>
                  withAttribute(f, key, value === missingOption ? null : value),
                )
              }
            />
          );
        })}
        {active.length > 0 && (
          <button
            type="button"
            className="text-xs underline"
            onClick={() => setFilters(clearAttributes)}
          >
            Clear attributes
          </button>
        )}
      </div>
    </details>
  );
}
