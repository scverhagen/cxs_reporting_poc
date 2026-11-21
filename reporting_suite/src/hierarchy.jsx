import { ChevronRight } from "lucide-react";
import { useView } from "./view-state";

export function employeeDirectory(data) {
  const reports = data.reports ? Object.values(data.reports) : [data];
  const directories = reports.map(
    (r) =>
      new Map(r.history.map((h) => [h.hierarchy, r.people[h.employee_id]])),
  );
  return new Map(
    [...directories[0]].filter(([path]) =>
      directories.every((d) => d.has(path)),
    ),
  );
}

export function childBranches(directory, path) {
  const prefix = path ? path + "/" : "";
  return [...directory]
    .filter(
      ([p]) =>
        p.startsWith(prefix) &&
        p !== path &&
        !p.slice(prefix.length).includes("/"),
    )
    .sort((a, b) => a[1].localeCompare(b[1]));
}

export function branchFilters(filters, path, mode = "team") {
  return { ...filters, hierarchy: path, hierarchyMode: mode };
}

function Path({ label, root, nodes, choose }) {
  const crumbs = [["", root], ...nodes];
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center gap-1 text-sm"
    >
      {crumbs.map(([id, name], i) => (
        <span key={id} className="inline-flex items-center gap-1">
          {i > 0 && (
            <ChevronRight size={13} className="text-muted-foreground" />
          )}
          {i === crumbs.length - 1 ? (
            <strong aria-current="location" className="font-medium">
              {name}
            </strong>
          ) : (
            <button
              className="text-primary underline-offset-2 hover:underline"
              onClick={() => choose(id)}
            >
              {name}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

export function employeePath(directory, path) {
  if (!path) return [];
  let prefix = "";
  return path.split("/").map((id) => {
    prefix = prefix ? prefix + "/" + id : id;
    return [prefix, directory.get(prefix) || "Unavailable"];
  });
}

export function EmployeePath({
  directory,
  path,
  individual,
  choose,
  root = "All visible employees",
}) {
  const nodes = employeePath(directory, path);
  if (individual) nodes.push(["individual", "Individual only"]);
  return (
    <Path label="Employee path" root={root} nodes={nodes} choose={choose} />
  );
}

export function EmployeeDrillLink({ data, id, date }) {
  const { drillEmployee } = useView();
  const name = data.people[id];
  if (!drillEmployee) return name;
  const assignment = data.history.find(
    (h) =>
      h.employee_id === id &&
      h.valid_from <= date &&
      (!h.valid_to || date < h.valid_to),
  );
  if (!assignment) return name;
  return (
    <button
      className="text-left underline decoration-dotted underline-offset-4 hover:decoration-solid"
      aria-label={"View individual records for " + name}
      onClick={() => drillEmployee(assignment.hierarchy)}
    >
      {name}
    </button>
  );
}

export function organizationLevel(organizations, org) {
  const orgs = new Map(organizations.map((o) => [o.org_id, o]));
  const orgNodes = [];
  for (
    let o = orgs.get(org);
    o && o.org_id !== "root";
    o = orgs.get(o.parent_org_id)
  )
    orgNodes.unshift([o.org_id, o.name]);
  const subOrgs = organizations.filter(
    (o) =>
      o.org_id !== "root" &&
      (org
        ? o.parent_org_id === org
        : !orgs.has(o.parent_org_id) || o.parent_org_id === "root"),
  );
  return { nodes: orgNodes, children: subOrgs, selected: orgs.get(org) };
}

export function OrganizationPath({ nodes, choose }) {
  return (
    <Path
      label="Organization path"
      root="All visible organizations"
      nodes={nodes}
      choose={choose}
    />
  );
}

// Retain the original scope labels in exports of existing saved views.
export function HierarchyMetadata({ data, filters, org }) {
  const path = filters.hierarchy;
  if (!path && !org) return null;
  const description =
    path &&
    employeePath(employeeDirectory(data), path)
      .map(([, name]) => name)
      .join(" › ");
  const { nodes } = organizationLevel(data.orgs, org);
  return (
    <>
      {path && (
        <span
          data-filter="Reporting hierarchy"
          data-value={
            description +
            (filters.hierarchyMode === "individual"
              ? " (individual)"
              : " (team)")
          }
        />
      )}
      {nodes.length > 0 && (
        <span
          data-filter="Organization path"
          data-value={nodes.map(([, name]) => name).join(" › ")}
        />
      )}
    </>
  );
}
