"""Resolve the three local demo personas against explicit customer grants."""

import hashlib
import json
from collections import defaultdict

ROLES = {"admin": "administrator", "manager": "manager", "employee": "employee"}
REPORTS = {
    "activity": "R1",
    "logins": "U1",
    "categories": "R2",
    "participation": "R1",
    "performance": "R3",
    "leaders": "R4",
    "investigation": "I1",
    "awards": "M1",
    "upcoming": "M1",
    "nonresponders": "M2",
    "wallets": "P1",
    "orders": "O1",
    "exceptions": "O2",
    "funding": "B1",
    "financial": "F1",
}


OVERVIEW_SOURCES = ("activity", "participation", "orders", "wallets", "awards", "funding", "logins")


class Problem(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def reporting_paths(assignments):
    """Split an assignment when any visible ancestor changes, using half-open dates."""
    dates = sorted({d for h in assignments for d in (h["valid_from"], h["valid_to"]) if d})
    result = []
    last = {}
    for index, start in enumerate(dates):
        end = dates[index + 1] if index + 1 < len(dates) else None
        active = {h["employee_id"]: h for h in assignments
                  if h["valid_from"] <= start and (not h["valid_to"] or start < h["valid_to"])}
        for employee, h in active.items():
            path = [employee]
            parent = h["manager_id"]
            while parent in active:
                if parent in path:
                    raise ValueError("Cycle in employee reporting relationships")
                path.append(parent)
                parent = active[parent]["manager_id"]
            branch = "/".join(reversed(path))
            previous = last.get(employee)
            if previous and previous["valid_to"] == start and h["valid_from"] < start and previous["hierarchy"] == branch:
                previous["valid_to"] = end
                continue
            row = {**h, "valid_from": start, "valid_to": end, "hierarchy": branch}
            del row["manager_id"]
            result.append(row)
            last[employee] = row
    return result


class Permissions:
    def __init__(self, db, tenant, owner):
        person = db.execute(
            """SELECT u.employee_id,e.display_name FROM reporting_users u
            JOIN employees e USING(tenant_id,employee_id)
            WHERE u.tenant_id=? AND u.user_id=? AND u.role=?""",
            (tenant, owner, ROLES.get(owner)),
        ).fetchone()
        if not person:
            raise Problem(403, "This demo role is unavailable for this customer.")
        self.employee, self.name = person
        self.owner = owner
        self.can_view_order_value = owner == "admin"
        self.fields = sorted(
            r[0]
            for r in db.execute(
                "SELECT field_name FROM field_grants WHERE tenant_id=? AND user_id=?",
                (tenant, owner),
            )
        )
        self.orgs = [
            dict(zip(("org_id", "name", "parent_org_id"), r))
            for r in db.execute(
                "SELECT org_id,name,parent_org_id FROM organizations WHERE tenant_id=?",
                (tenant,),
            )
        ]
        self.rules = defaultdict(list)
        fifo = db.execute(
            "SELECT fifo_enabled FROM tenants WHERE tenant_id=?", (tenant,)
        ).fetchone()[0]
        for code, program, org, children, personal in db.execute(
            """SELECT report_id,program_id,org_id,include_descendants,self_only
            FROM report_grants WHERE tenant_id=? AND user_id=? ORDER BY grant_id""",
            (tenant, owner),
        ):
            if code == "P1" and "employee_balance" not in self.fields:
                continue
            if code == "F1" and (
                not fifo or "financial_allocations" not in self.fields
            ):
                continue
            if owner == "admin" and not (personal or org or program):
                self.rules[code].append((None, None))
            elif (
                owner == "employee"
                and personal
                and not (org or program)
                and code in ("M1", "P1", "O1", "U1")
            ):
                self.rules[code].append((None, None))
            elif (
                owner == "manager"
                and org
                and not personal
                and code in ("R1", "R2", "M1", "M2", "U1")
                and (code != "U1" or program is None)
            ):
                group = {org}
                if children:
                    for _ in self.orgs:
                        group.update(
                            row["org_id"]
                            for row in self.orgs
                            if row["parent_org_id"] in group
                        )
                self.rules[code].append((program, sorted(group)))
        self.tabs = [tab for tab, code in REPORTS.items() if code in self.rules]
        self.overview_tabs = [tab for tab in OVERVIEW_SOURCES if tab in self.tabs]
        self.history = []
        if owner != "admin":
            allowed_orgs = {
                org
                for rules in self.rules.values()
                for _, orgs in rules
                for org in (orgs or [])
            }
            self.history = [
                dict(zip(("employee_id", "org_id", "valid_from", "valid_to"), r))
                for r in db.execute(
                    """SELECT employee_id,org_id,valid_from,valid_to FROM employee_history WHERE tenant_id=?
                    ORDER BY employee_id,valid_from""",
                    (tenant,),
                )
                if (owner == "employee" and r[0] == self.employee)
                or (owner == "manager" and r[1] in allowed_orgs)
            ]

    def assignment_history(self, db, tenant, tab):
        rules = self.rules.get(REPORTS.get(tab), [])
        orgs = {org for _, group in rules for org in (group or [])}
        assignments = [
            dict(row) for row in db.execute("""
                SELECT employee_id, org_id, manager_id, valid_from, valid_to, attributes_json
                FROM employee_history WHERE tenant_id=? ORDER BY employee_id, valid_from
            """, (tenant,))
            if self.owner == "admin" or
            (self.owner == "employee" and row["employee_id"] == self.employee) or
            (self.owner == "manager" and row["org_id"] in orgs)
        ]
        # Build paths after applying the grant. An unseen supervisor never enters the directory.
        return reporting_paths(assignments)

    def require(self, tab, legacy=False, *, include_budgets=True, include_logins=True):
        if tab in ("overview", "teams") and self.overview_tabs:
            sources = {
                key: self.require(key, legacy) for key in self.overview_tabs
                if (include_budgets or key != "funding") and (include_logins or key != "logins")
            }
            return hashlib.sha256(
                json.dumps(sources, sort_keys=True).encode()
            ).hexdigest()
        if tab not in self.tabs:
            raise Problem(403, "This report is unavailable for the selected role.")
        # Preserve permission checks on files created by the original admin-only POC.
        fields = [
            f for f in self.fields if not legacy or not f.startswith("attribute:")
        ]
        if self.owner == "admin":
            return json.dumps(fields)
        permissions = [
            fields,
            self.employee,
            self.rules[REPORTS[tab]],
            self.history,
        ]
        if tab in ("orders", "exceptions"):
            # Files generated before monetary fields were restricted must expire from access.
            permissions.append({"order_value": self.can_view_order_value})
        scope = json.dumps(permissions, sort_keys=True)
        return hashlib.sha256(scope.encode()).hexdigest()

    def allows(self, code, employee, program, date):
        if self.owner == "employee":
            return employee == self.employee
        return any(
            (not p or p == program)
            and any(
                h["employee_id"] == employee
                and h["org_id"] in orgs
                and h["valid_from"] <= date
                and (not h["valid_to"] or date < h["valid_to"])
                for h in self.history
            )
            for p, orgs in self.rules[code]
        )

    def scope_label(self, tab):
        if self.owner == "admin":
            return "Customer-wide access"
        if self.owner == "employee":
            return "Personal records"
        groups = {
            org for _, orgs in self.rules.get(REPORTS.get(tab), []) for org in orgs
        }
        return (
            ", ".join(
                o["name"]
                for o in self.orgs
                if o["org_id"] in groups and o["parent_org_id"] not in groups
            )
            or "Team records"
        )
