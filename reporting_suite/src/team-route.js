export function readTeamRoute() {
  const params = new URLSearchParams(location.hash.slice(1));
  const tab = params.get("report");
  if (!hasTeamPages(tab)) return null;
  return {
    tab,
    customer: params.get("customer"),
    role: params.get("role"),
    page: {
      managerPath: params.get("path") || "",
      pageMode: params.get("view") === "individual" ? "individual" : "team",
    },
  };
}

export function hasTeamPages(tab) {
  return tab === "teams" || hasRecognitionTeams(tab);
}

export function hasRecognitionTeams(tab) {
  return [
    "activity",
    "categories",
    "participation",
    "performance",
    "leaders",
    "investigation",
    "logins",
  ].includes(tab);
}

export function teamUrl(customer, role, page, report) {
  const params = new URLSearchParams({ report, customer, role });
  if (page.managerPath) params.set("path", page.managerPath);
  if (page.pageMode === "individual") params.set("view", "individual");
  return "#" + params;
}
