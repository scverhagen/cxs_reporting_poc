import { BrandEditor, ThemePicker, useAppearance } from "./appearance";
import { employeeDirectory, employeePath } from "./hierarchy";
import { TeamReport, teamPageTitle } from "./team-report";
import {
  hasRecognitionTeams,
  hasTeamPages,
  readTeamRoute,
  teamUrl,
} from "./team-route";
import { RollingDates } from "./rolling-dates";
import {
  EmployeeAttributes,
  assignmentScope,
  clearAttributes,
} from "./employee-attributes";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Network,
  LayoutDashboard,
  Activity,
  Tags,
  Users,
  Award,
  CalendarDays,
  Clock,
  ChartNoAxesCombined,
  Search,
  ChevronRight,
  RotateCcw,
  PanelsTopLeft,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CompareFilter,
  ReportComparison,
  comparableReports,
} from "./period-comparison";
import { Overview } from "./overview";
import { DateField } from "./report-tools";
import { Filter } from "./shared";
import { Milestones, ages, types } from "./milestones";
import { milestoneDate } from "./metrics";
import { catalog, CatalogReport } from "./catalog";
import { Workspace } from "./workspace";
import { ViewState, defaults, orgScope, periods } from "./view-state";
import "./theme.css";
const reports = {
  ...catalog,
  teams: [
    "Managerial hierarchy",
    "Navigate from a manager’s team to a direct report’s results.",
    Network,
  ],
  overview: [
    "Overview",
    "Key numbers and trends for your reporting scope.",
    LayoutDashboard,
  ],
  activity: [
    "Recognition activity",
    "Explore approved recognition, points, and engagement across your programs.",
    Activity,
  ],
  categories: [
    "Categories & values",
    "See which categories and organizational values employees recognize.",
    Tags,
  ],
  participation: [
    "Participation",
    "Compare sending and receiving activity across eligible employee populations.",
    Users,
  ],
  awards: [
    "Awards overview",
    "Track milestone eligibility, outstanding awards, and redemption.",
    Award,
  ],
  upcoming: [
    "Upcoming milestones",
    "Plan for employees approaching milestone eligibility.",
    CalendarDays,
  ],
  nonresponders: [
    "Non-responders",
    "Follow up on eligible employees with outstanding milestone awards.",
    Clock,
  ],
};
const milestoneTabs = ["awards", "upcoming", "nonresponders"];
function Finder({ navigate, allowed }) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  useEffect(() => {
    function shortcut(e) {
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !document.querySelector('[role="dialog"]') &&
        !e.target.closest("input,select,textarea,[contenteditable]")
      ) {
        e.preventDefault();
        setQuery("");
        setOpen(true);
      }
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  const matches = Object.entries(reports).filter(
    ([key, r]) =>
      allowed.includes(key) &&
      r[0].toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setQuery("");
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Search aria-hidden="true" />
          Find a report{" "}
          <kbd className="rounded border px-1 text-xs text-muted-foreground">
            /
          </kbd>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Find a report</DialogTitle>
        <DialogDescription className="sr-only">
          Search the reporting catalog by name.
        </DialogDescription>
        <Input
          autoFocus
          type="search"
          aria-label="Search report names"
          placeholder="Search report names…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="grid gap-1">
          {matches.map(([key, [name, , Icon]]) => (
            <Button
              key={key}
              variant="ghost"
              className="justify-start"
              onClick={() => {
                setOpen(false);
                navigate(key);
              }}
            >
              <Icon />
              {name}
            </Button>
          ))}
          {!matches.length && <p>No matching reports.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
async function get(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error("Could not load reporting data.");
  return response.json();
}
function teamDefaults(tab) {
  return tab === "investigation" ? { ...defaults, period: "all" } : defaults;
}

const initialTeam = readTeamRoute();
function App() {
  const [config, setConfig] = useState(null),
    [customer, setCustomer] = useState(initialTeam?.customer || "meridian"),
    [snapshot, setData] = useState(null),
    [switching, setSwitching] = useState(false),
    [error, setError] = useState("");
  const [preferred, setTab] = useState(initialTeam?.tab || "overview"),
    [filters, setFilters] = useState(defaults),
    [tag, setTag] = useState(() =>
      initialTeam?.tab === "activity" ? history.state?.tag || null : null,
    );
  const [dashboardFilters, setDashboardFilters] = useState(defaults);
  const [teamPage, setTeamPage] = useState(initialTeam?.page || {});
  const [teamFilters, setTeamFilters] = useState(() =>
    initialTeam
      ? { ...teamDefaults(initialTeam.tab), ...history.state?.teamFilters }
      : defaults,
  );
  const [options, setOptions] = useState(() =>
    initialTeam ? history.state?.options || {} : {},
  );
  const [resetVersion, setResetVersion] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    get("/api/customers", c.signal)
      .then((loaded) => {
        if (
          initialTeam &&
          !loaded.customers.some((c) => c.tenant_id === initialTeam.customer)
        ) {
          history.replaceState(null, "", location.pathname + location.search);
          setCustomer(loaded.customers[0]?.tenant_id || "meridian");
          setTeamPage({});
          setTeamFilters(defaults);
          setTab("overview");
        }
        setConfig(loaded);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  const activeCustomer = config?.customers.find(
    (c) => c.tenant_id === customer,
  );
  const appearance = useAppearance(activeCustomer?.branding);
  const role = config?.role;
  const tabs = activeCustomer?.tabs;
  const allowed = activeCustomer?.overview_available
    ? ["overview", "teams", ...tabs]
    : tabs || [];
  const tab = allowed.includes(preferred)
    ? preferred
    : role === "employee" && allowed.includes("wallets")
      ? "wallets"
      : allowed[0];
  const source =
    !switching &&
    snapshot?.customer === customer &&
    snapshot.viewer.role === role &&
    snapshot.tab === tab
      ? snapshot
      : null;
  const pageTitle =
    hasTeamPages(tab) && source
      ? teamPageTitle(
          employeeDirectory(source),
          teamPage.managerPath,
          teamPage.pageMode,
          tab,
        )
      : reports[tab]?.[0];
  const data = assignmentScope(
    source,
    hasTeamPages(tab)
      ? teamFilters
      : tab === "overview"
        ? dashboardFilters
        : filters,
  );
  useEffect(() => {
    if (!role || !tab || switching) return;
    const c = new AbortController();
    get("/api/report?" + new URLSearchParams({ customer, role, tab }), c.signal)
      .then((d) => {
        if (!c.signal.aborted) setData({ ...d, customer });
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [customer, role, tab, tabs, switching]);
  useEffect(() => {
    const refresh = (e) => {
      if (e.key === "cxs-role-change") location.reload();
    };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  useEffect(() => {
    document.title = (pageTitle || "Reports") + " · CXS Recognize";
  }, [pageTitle]);
  useEffect(() => {
    if (!role) return;
    function restore() {
      const route = readTeamRoute();
      setTag(null);
      if (
        route &&
        route.customer === customer &&
        route.role === role &&
        allowed.includes(route.tab)
      ) {
        setTab(route.tab);
        if (route.tab === "activity") setTag(history.state?.tag || null);
        setOptions(history.state?.options || {});
        setTeamPage(route.page);
        setTeamFilters({
          ...teamDefaults(route.tab),
          ...history.state?.teamFilters,
        });
      } else if (route) {
        history.replaceState(null, "", location.pathname + location.search);
        setTeamPage({});
        setTeamFilters(defaults);
        setTab("overview");
      } else if (
        history.state?.customer === customer &&
        history.state?.role === role
      ) {
        setTab(history.state.tab || "overview");
      } else {
        setTab("overview");
      }
    }
    if (readTeamRoute()) restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [customer, role]);
  useEffect(() => {
    const route = readTeamRoute();
    if (
      hasTeamPages(tab) &&
      route?.tab === tab &&
      route.customer === customer &&
      route.role === role
    )
      history.replaceState({ teamFilters, options, tag }, "");
  }, [tab, teamFilters, customer, role, options, tag]);
  function clearTeamPage() {
    if (readTeamRoute())
      history.replaceState(null, "", location.pathname + location.search);
    setTeamPage({});
    setTeamFilters(defaults);
  }
  async function switchRole(next) {
    if (switching || role === next) return;
    setSwitching(true);
    clearTeamPage();
    setData(null);
    setError("");
    setOptions({});
    setTag(null);
    setFilters(defaults);
    setDashboardFilters(defaults);
    try {
      const r = await fetch("/api/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      if (!r.ok) throw Error("Could not switch demo role.");
      const updated = await get("/api/customers");
      const grants = updated.customers.find((c) => c.tenant_id === customer);
      if (
        hasTeamPages(tab) &&
        (tab === "teams"
          ? grants?.overview_available
          : grants?.tabs.includes(tab))
      )
        history.replaceState(
          { teamFilters: teamDefaults(tab) },
          "",
          teamUrl(customer, updated.role, {}, tab),
        );
      setConfig(updated);
      localStorage.setItem("cxs-role-change", String(Date.now()));
    } catch (e) {
      setError(e.message);
    } finally {
      setSwitching(false);
    }
  }
  const isMilestone = milestoneTabs.includes(tab),
    asOf = config?.as_of.slice(0, 10) || "";
  const change = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setTag(null);
  };
  function teamEntryFilters() {
    if (hasTeamPages(tab)) return teamFilters;
    const { hierarchy, hierarchyMode, breakdown, ...rest } =
      tab === "overview" ? dashboardFilters : filters;
    if (catalog[tab]) {
      return {
        ...rest,
        period:
          options.dateMode && options.dateMode !== "custom"
            ? options.dateMode
            : "custom",
        start: options.start || "2026-01-01",
        end: options.end || asOf,
        org: options.org || "",
        program: options.program || "",
      };
    }
    if (isMilestone)
      return {
        ...rest,
        period:
          rest.eligibilityPeriod === "any" ? "all" : rest.eligibilityPeriod,
      };
    return rest;
  }
  function openTeamPage(
    report,
    path,
    mode,
    settings,
    nextOptions,
    nextTag = null,
  ) {
    if (!allowed.includes(report)) return;
    const page = { managerPath: path, pageMode: mode };
    if (!readTeamRoute()) history.replaceState({ tab, customer, role }, "");
    const url = teamUrl(customer, role, page, report);
    if (url !== location.hash)
      history.pushState(
        { teamFilters: settings, options: nextOptions, tag: nextTag },
        "",
        url,
      );
    setOptions(nextOptions);
    setTag(nextTag);
    setTeamFilters(settings);
    setTeamPage(page);
    setTab(report);
    setMobileNav(false);
    setError("");
    window.scrollTo(0, 0);
  }
  function navigateTeamPage(path, mode = "team") {
    openTeamPage(tab, path, mode, teamFilters, options, tag);
  }
  function openTeam(path = "", mode = "team", settings = teamEntryFilters()) {
    openTeamPage("teams", path, mode, settings, {});
  }
  function openRecognitionReport(
    report,
    settings,
    savedOptions = {},
    savedTag = null,
  ) {
    // Old saved views store the employee path with the filters.
    const { hierarchy = "", hierarchyMode = "team", ...rest } = settings;
    const {
      managerPath = hierarchy,
      pageMode = hierarchyMode,
      ...display
    } = savedOptions;
    openTeamPage(
      report,
      managerPath,
      pageMode,
      rest,
      display,
      report === "activity" ? savedTag : null,
    );
  }
  function navigate(key) {
    if (!allowed.includes(key)) return;
    if (key === "teams") return openTeam();
    if (hasRecognitionTeams(key))
      return openRecognitionReport(
        key,
        hasTeamPages(tab)
          ? teamFilters
          : key === "investigation"
            ? { ...filters, period: "all" }
            : filters,
      );
    if (hasRecognitionTeams(tab)) setFilters(teamFilters);
    if (readTeamRoute())
      history.pushState(
        { tab: key, customer, role },
        "",
        location.pathname + location.search,
      );
    setError("");
    setOptions({});
    setTag(null);
    if (!comparableReports.includes(key))
      setFilters((f) => ({ ...f, compare: "off" }));
    setTab(key);
    setMobileNav(false);
  }
  function switchCustomer(id) {
    if (id === customer) return;
    if (hasTeamPages(tab)) {
      const dates = Object.fromEntries(
        [
          "period",
          "start",
          "end",
          "compare",
          "comparisonStart",
          "comparisonEnd",
        ].map((key) => [key, teamFilters[key]]),
      );
      const nextFilters = { ...defaults, ...dates };
      history.replaceState(
        { teamFilters: nextFilters },
        "",
        teamUrl(id, role, {}, tab),
      );
      setTeamPage({});
      setTeamFilters(nextFilters);
    } else clearTeamPage();
    setOptions((old) =>
      Object.fromEntries(
        Object.entries(old).filter(([k]) =>
          ["dateMode", "start", "end"].includes(k),
        ),
      ),
    );
    setData(null);
    setError("");
    setTag(null);
    setCustomer(id);
    setDashboardFilters((f) => ({
      ...clearAttributes(f),
      hierarchy: "",
      hierarchyMode: "team",
      org: "",
      breakdown: "",
    }));
    setFilters((f) => ({
      ...clearAttributes(f),
      hierarchy: "",
      hierarchyMode: "team",
      org: "",
      program: "",
      type: "",
      mp: "",
    }));
  }
  const filter = (key, label, options) => (
    <Filter
      {...{ label, options }}
      value={filters[key]}
      onChange={(v) => change(key, v)}
    />
  );
  const scope = data && orgScope(filters.org, data.orgs);
  function links(keys) {
    return keys
      .filter((key) => allowed.includes(key))
      .map((key) => {
        const [name, , Icon] = reports[key];
        return (
          <Button
            key={key}
            variant={key === tab ? "secondary" : "ghost"}
            size="sm"
            className="w-full justify-start gap-2.5"
            aria-current={key === tab ? "page" : undefined}
            onClick={() => navigate(key)}
          >
            <Icon className="text-muted-foreground" />
            {name}
          </Button>
        );
      });
  }
  function renderFilters(controls) {
    const overview = tab === "overview";
    const teams = hasTeamPages(tab);
    const active = teams ? teamFilters : overview ? dashboardFilters : filters;
    return (
      <section
        aria-label="Report filters"
        className={
          tab === "teams"
            ? "space-y-3 border-t px-4 py-3"
            : "space-y-3 rounded-xl border bg-card px-4 py-3"
        }
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Filters</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (teams) {
                setTeamFilters(teamDefaults(tab));
                if (tab === "activity" || tab === "investigation") {
                  setTag(null);
                  setOptions({});
                }
              } else if (overview) setDashboardFilters(defaults);
              else {
                setFilters(defaults);
                setTag(null);
                setOptions({});
              }
              setResetVersion((n) => n + 1);
            }}
          >
            <RotateCcw />
            Reset filters
          </Button>
        </div>
        {controls}
        <EmployeeAttributes
          data={source}
          filters={active}
          setFilters={
            teams ? setTeamFilters : overview ? setDashboardFilters : setFilters
          }
        />
        <RollingDates {...{ tab, asOf, options }} filters={active} />
      </section>
    );
  }
  const customerName = config?.customers.find(
    (c) => c.tenant_id === customer,
  )?.name;
  return (
    <ViewState.Provider
      value={{
        options,
        setOptions,
        drillEmployee:
          tab === "activity"
            ? (path) => navigateTeamPage(path, "individual")
            : allowed.includes("teams")
              ? (path) => openTeam(path, "individual")
              : null,
      }}
    >
      <div className="min-h-dvh">
        <header className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-3 border-b bg-card px-3 py-2 sm:px-5">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Toggle reports navigation"
            aria-expanded={mobileNav}
            onClick={() => setMobileNav((v) => !v)}
          >
            <PanelsTopLeft />
          </Button>
          <div className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ChartNoAxesCombined size={18} />
            </span>
            CXS Recognize
          </div>
          <Separator
            orientation="vertical"
            className="mx-1 hidden h-5 sm:block"
          />
          <span className="hidden text-sm text-muted-foreground sm:inline">
            Analytics
          </span>
          <div className="ml-auto">
            <Finder navigate={navigate} allowed={switching ? [] : allowed} />
          </div>
          <Badge variant="secondary" className="hidden sm:flex">
            {role ? "Demo " + role : "Demo"}
          </Badge>
        </header>
        <div className="flex flex-col lg:flex-row">
          <aside
            className={
              (mobileNav ? "flex" : "hidden") +
              " shrink-0 flex-col border-b bg-card p-4 lg:sticky lg:top-14 lg:flex lg:h-[calc(100dvh-3.5rem)] lg:w-60 lg:overflow-y-auto lg:border-r lg:border-b-0"
            }
          >
            {config && (
              <Filter
                label="Customer"
                value={customer}
                onChange={switchCustomer}
                options={config.customers.map((c) => [c.tenant_id, c.name])}
              />
            )}
            {config && (
              <fieldset disabled={switching} className="mt-3 grid gap-2">
                <Filter
                  label="Demo role"
                  value={role}
                  onChange={switchRole}
                  options={[
                    ["admin", "Admin"],
                    ["manager", "Manager"],
                    ["employee", "Employee"],
                  ]}
                />
                <div
                  className="text-xs text-muted-foreground"
                  aria-live="polite"
                >
                  {switching
                    ? "Switching role…"
                    : activeCustomer?.name_of_viewer}
                  {data && <div className="mt-0.5">{data.viewer.scope}</div>}
                </div>
              </fieldset>
            )}
            <div className="mt-4 grid gap-2">
              <ThemePicker {...appearance} />
              {role === "admin" && activeCustomer?.branding && !switching && (
                <BrandEditor
                  key={customer}
                  customer={activeCustomer}
                  onSaved={(branding) => setConfig((current) => ({
                    ...current,
                    customers: current.customers.map((entry) =>
                      entry.tenant_id === customer ? { ...entry, branding } : entry),
                  }))}
                />
              )}
            </div>
            <Separator className="my-5" />
            <nav aria-label="Reports" className="grid gap-1">
              {links(["overview", "teams"])}
              {[
                [
                  "Recognition reports",
                  [
                    "activity",
                    "categories",
                    "participation",
                    "performance",
                    "leaders",
                    "investigation",
                  ],
                ],
                ["User activity", ["logins"]],
                ["Milestone reports", milestoneTabs],
                ["Rewards & fulfillment", ["wallets", "orders", "exceptions"]],
                ["Finance", ["funding", "financial"]],
              ].map(
                ([title, keys]) =>
                  keys.some((k) => allowed.includes(k)) && (
                    <div key={title} className="mb-3 grid gap-1">
                      <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">
                        {title}
                      </p>
                      {links(keys)}
                    </div>
                  ),
              )}
            </nav>
            <div className="mt-auto pt-6 text-xs text-muted-foreground">
              <Separator className="mb-3" />
              <div className="flex items-center gap-2">
                <Database size={14} /> Sample workspace
              </div>
            </div>
          </aside>
          <main className="mx-auto w-full min-w-0 max-w-[1600px] space-y-4 p-4 sm:p-6 xl:p-8">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {customerName}
              <ChevronRight size={13} />
              {tab !== "overview" && allowed.includes("overview") && (
                <>
                  <button
                    aria-label="Return to overview"
                    className="hover:underline"
                    onClick={() => navigate("overview")}
                  >
                    Overview
                  </button>
                  <ChevronRight size={13} />
                </>
              )}
              {tab === "overview" || tab === "teams"
                ? "Analytics"
                : catalog[tab]?.[4] ||
                  (isMilestone ? "Milestones" : "Recognition")}
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {pageTitle || "Reports"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {reports[tab]?.[1]}
              </p>
            </div>
            {source &&
              !hasTeamPages(tab) &&
              (tab === "overview" ? dashboardFilters : filters).hierarchy &&
              (() => {
                const saved = tab === "overview" ? dashboardFilters : filters;
                const label = employeePath(
                  employeeDirectory(source),
                  saved.hierarchy,
                )
                  .map(([, name]) => name)
                  .join(" › ");
                return (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span>Saved scope · {label}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        openTeam(saved.hierarchy, saved.hierarchyMode)
                      }
                    >
                      Open team report
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        (tab === "overview" ? setDashboardFilters : setFilters)(
                          (f) => ({
                            ...f,
                            hierarchy: "",
                            hierarchyMode: "team",
                          }),
                        )
                      }
                    >
                      Show all
                    </Button>
                  </div>
                );
              })()}
            {config && !switching && (data || !tab) && (
              <Workspace
                key={customer + role}
                {...{ customer, customerName, reports, role, asOf, pageTitle }}
                view={
                  hasTeamPages(tab)
                    ? {
                        tab,
                        filters: teamFilters,
                        options: {
                          managerPath: "",
                          pageMode: "team",
                          ...options,
                          ...teamPage,
                        },
                        tag: tab === "activity" ? tag : null,
                      }
                    : tab === "overview"
                      ? {
                          tab,
                          filters: dashboardFilters,
                          options: {},
                          tag: null,
                        }
                      : { tab, filters, options, tag }
                }
                load={(v) => {
                  if (v.tab === "teams") {
                    openTeam(v.options.managerPath, v.options.pageMode, {
                      ...defaults,
                      ...v.filters,
                    });
                    return;
                  }
                  if (hasRecognitionTeams(v.tab)) {
                    openRecognitionReport(
                      v.tab,
                      { ...defaults, ...v.filters },
                      v.options,
                      v.tag,
                    );
                    return;
                  }
                  navigate(v.tab);
                  if (v.tab === "overview") {
                    setDashboardFilters({ ...defaults, ...v.filters });
                    return;
                  }
                  setFilters({ ...defaults, ...v.filters });
                  setOptions(v.options);
                  setTag(v.tag);
                }}
              />
            )}
            {error ? (
              <p role="alert">{error}</p>
            ) : config && !tab ? (
              <p>No reports are assigned to this role for {customerName}.</p>
            ) : !data || !config ? (
              <p role="status">Loading customer data…</p>
            ) : hasTeamPages(tab) ? (
              <TeamReport
                source={source}
                filters={teamFilters}
                setFilters={setTeamFilters}
                page={teamPage}
                {...{ asOf, renderFilters, tag, setTag, tab }}
                navigate={navigateTeamPage}
                onTag={
                  allowed.includes("activity")
                    ? (selection) =>
                        openRecognitionReport(
                          "activity",
                          teamFilters,
                          teamPage,
                          selection,
                        )
                    : undefined
                }
              />
            ) : tab === "overview" ? (
              <Overview
                openTeam={openTeam}
                {...{ data, asOf }}
                filters={dashboardFilters}
                setFilters={setDashboardFilters}
                renderFilters={renderFilters}
                source={source}
                names={reports}
                openReport={(key, nextFilters, nextOptions) => {
                  if (hasRecognitionTeams(key))
                    return openRecognitionReport(key, nextFilters, nextOptions);
                  navigate(key);
                  setFilters(nextFilters);
                  setOptions(nextOptions);
                  window.scrollTo(0, 0);
                }}
              />
            ) : catalog[tab] ? (
              <CatalogReport
                key={customer + tab + resetVersion}
                {...{ tab, data, asOf, filters, setFilters, renderFilters }}
              />
            ) : (
              <>
                {renderFilters(
                  <div className="flex flex-wrap items-end gap-2.5">
                    {filter("eligibilityPeriod", "Eligibility period", [
                      ["any", "All eligibility dates"],
                      ...periods(asOf),
                    ])}
                    {filters.eligibilityPeriod === "custom" && (
                      <>
                        <DateField
                          name="From"
                          value={filters.start}
                          onChange={(v) => change("start", v)}
                          max={asOf}
                        />
                        <DateField
                          name="Through"
                          value={filters.end}
                          onChange={(v) => change("end", v)}
                          max={asOf}
                        />
                      </>
                    )}
                    {filter("mp", "Milestone program", [
                      ["", "All milestone programs"],
                      ...Object.entries(data.milestone_programs),
                    ])}
                    {filter("type", "Milestone type", [
                      ["", "All types"],
                      ...Array.from(
                        new Set(data.milestones.map((r) => r.milestone_type)),
                      )
                        .sort()
                        .map((t) => [t, types(t)]),
                    ])}
                    {tab === "upcoming" &&
                      filter("horizon", "Upcoming within", [
                        ["30", "30 days"],
                        ["60", "60 days"],
                        ["90", "90 days"],
                        ["all", "Any future date"],
                      ])}
                    {tab === "nonresponders" &&
                      filter("age", "Outstanding age", [
                        ["", "All ages"],
                        ...ages.map((a) => [a, a + " days"]),
                      ])}
                    {filter("org", "Organization", [
                      [
                        "",
                        role === "admin"
                          ? "All organizations"
                          : "All visible organizations",
                      ],
                      ...data.orgs
                        .filter((o) => o.org_id !== "root")
                        .map((o) => [
                          o.org_id,
                          (!o.parent_org_id || o.parent_org_id === "root"
                            ? ""
                            : "　") + o.name,
                        ]),
                    ])}
                    {comparableReports.includes(tab) && (
                      <CompareFilter {...{ filters, setFilters, asOf }} />
                    )}
                  </div>,
                )}
                <Separator />
                <ReportComparison {...{ tab, data, filters, asOf, tag }}>
                  <Milestones
                    {...{ data, tab, asOf, scope, filters }}
                    drill={(view, k, v) => {
                      change(k, v);
                      navigate(view);
                    }}
                  />
                </ReportComparison>
              </>
            )}
            {data &&
              !error &&
              (isMilestone ||
                [
                  "activity",
                  "categories",
                  "performance",
                  "leaders",
                  "investigation",
                ].includes(tab)) && (
                <footer className="text-xs text-muted-foreground">
                  {isMilestone
                    ? "Milestone entitlements"
                    : tab === "investigation"
                      ? "Submission date · UTC"
                      : "Approval date · UTC"}
                  {!isMilestone && tab !== "leaders" && teamFilters.org
                    ? " · Sender organization"
                    : ""}{" "}
                  · Data as of {milestoneDate(asOf)} at{" "}
                  {config.as_of.slice(11, 16)} UTC
                </footer>
              )}
          </main>
        </div>
      </div>
    </ViewState.Provider>
  );
}
createRoot(document.getElementById("root")).render(<App />);
