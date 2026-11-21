"""Local SQLite reporting demo. Run with python3 reporting_suite/app.py."""

import argparse
import json
import sqlite3
from contextlib import closing
from http.cookies import SimpleCookie, CookieError
from permissions import Permissions, REPORTS, ROLES, Problem
import threading
import workspace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from catalog_data import catalog_snapshot

HERE = Path(__file__).resolve().parent
DATABASE = HERE.parent / "sample_data/reporting_poc.sqlite"
ASSETS = {
    "/": ("index.html", "text/html"),
    "/app.js": ("app.js", "text/javascript"),
    "/index.css": ("index.css", "text/css"),
}


def rows(db, sql, *args):
    return [dict(row) for row in db.execute(sql, args)]


def recognition_rows(db, tenant, fields):
    # Every child is joined back at event grain before any totals are calculated.
    events = rows(
        db,
        """SELECT recognition_id AS id, program_id AS program, sender_id AS sender,
        activity_at AS at, submitted_at, issued_at, notified_at, is_private, message,
        points_awarded AS points FROM v_official_recognition WHERE tenant_id=?
        ORDER BY activity_at DESC, recognition_id""",
        tenant,
    )
    by_id = {event["id"]: event for event in events}
    can_read_message = "recognition_message" in fields
    for event in events:
        if not can_read_message or event["is_private"]:
            event["message"] = None
        event.update(
            recipients=[],
            recipient_points={},
            components=[],
            category=[],
            value=[],
            likes=0,
            comments=0,
        )
    for rid, employee, points in db.execute(
        "SELECT recognition_id,employee_id,points FROM recognition_recipients WHERE tenant_id=?",
        (tenant,),
    ):
        if rid in by_id:
            by_id[rid]["recipients"].append(employee)
            by_id[rid]["recipient_points"][employee] = points
    for rid, kind, label in db.execute(
        """SELECT recognition_id,tag_type,label FROM recognition_tags WHERE tenant_id=?
        UNION ALL SELECT recognition_id,'components',component FROM recognition_components WHERE tenant_id=?""",
        (tenant, tenant),
    ):
        if rid in by_id:
            by_id[rid][kind].append(label)
    for rid, kind, total in db.execute(
        """SELECT recognition_id,kind,count(*) FROM social_events
        WHERE tenant_id=? AND occurred_at <= (SELECT value FROM dataset_metadata WHERE key='data_as_of')
        GROUP BY recognition_id,kind""",
        (tenant,),
    ):
        if rid in by_id:
            by_id[rid]["likes" if kind == "like" else "comments"] = total
    return events


def snapshot(db, tenant, owner="admin", tab=None):
    policy = Permissions(db, tenant, owner)
    if not policy.tabs:
        raise Problem(403, "No reports are assigned to this role.")
    if tab is not None:
        policy.require(tab)
    elif owner != "admin":
        tab = next(iter(policy.tabs), None)
    if tab in ("overview", "teams"):
        reports = {
            key: report_snapshot(db, tenant, policy, key)
            for key in policy.overview_tabs
        }
        first = next(iter(reports.values()))
        # Every drill-through destination must be able to represent the selected organization.
        common_orgs = set.intersection(
            *({o["org_id"] for o in r["orgs"]} for r in reports.values())
        )
        scopes = dict.fromkeys(r["viewer"]["scope"] for r in reports.values())
        return dict(
            tab=tab,
            reports=reports,
            currency=first["currency"],
            viewer={**first["viewer"], "scope": " · ".join(scopes)},
            orgs=[o for o in first["orgs"] if o["org_id"] in common_orgs],
        )
    return report_snapshot(db, tenant, policy, tab)


def report_snapshot(db, tenant, policy, tab):
    owner = policy.owner
    codes = {REPORTS[tab]} if tab else set(policy.rules)
    code = REPORTS.get(tab)
    as_of = db.execute(
        "SELECT value FROM dataset_metadata WHERE key='data_as_of'"
    ).fetchone()[0][:10]
    restricted = owner != "admin"
    events = (
        recognition_rows(db, tenant, policy.fields)
        if codes & {"R1", "R2", "R3", "R4"}
        else []
    )
    attributes = [
        f.removeprefix("attribute:")
        for f in policy.fields
        if f.startswith("attribute:")
    ]
    history = policy.assignment_history(db, tenant, tab)
    for h in history:
        values = json.loads(h.pop("attributes_json"))
        h["attributes"] = {
            k: str(values[k])
            for k in attributes
            if isinstance(values.get(k), (str, float, int))
        }
    programs = dict(
        db.execute(
            "SELECT program_id,name FROM programs WHERE tenant_id=? AND program_type='recognition' ORDER BY name",
            (tenant,),
        )
    )
    milestone_programs = dict(
        db.execute(
            "SELECT program_id,name FROM programs WHERE tenant_id=? AND program_type='milestone' ORDER BY name",
            (tenant,),
        )
    )
    eligibility = (
        rows(
            db,
            """SELECT employee_id,program_id,can_send,can_receive,valid_from,valid_to FROM eligibility
        WHERE tenant_id=? AND program_id IN (SELECT program_id FROM programs WHERE tenant_id=? AND program_type='recognition')""",
            tenant,
            tenant,
        )
        if codes & {"R1", "R3", "R4"}
        else []
    )
    milestones = (
        rows(
            db,
            """SELECT entitlement_id,employee_id,program_id,milestone_type,milestone_date,eligible_on,
        expires_on,redeemed_at,notified_at,notification_status,award_value_minor,entitlement_state,outstanding_age_days,aging_bucket
        FROM v_milestone_state WHERE tenant_id=? ORDER BY eligible_on,entitlement_id""",
            tenant,
        )
        if codes & {"M1", "M2"}
        else []
    )
    people = dict(
        db.execute(
            "SELECT employee_id,display_name FROM employees WHERE tenant_id=?",
            (tenant,),
        )
    )
    orgs = policy.orgs
    if restricted:
        rules = policy.rules.get(code, [])
        if owner == "manager":
            allowed_orgs = {org for _, group in rules for org in group}
            allowed_programs = {p for p, _ in rules}
            if None not in allowed_programs:
                programs = {k: v for k, v in programs.items() if k in allowed_programs}
                milestone_programs = {
                    k: v for k, v in milestone_programs.items() if k in allowed_programs
                }
            eligible = []
            for e in eligibility:
                for h in history:
                    if e["employee_id"] != h["employee_id"] or not any(
                        (not p or p == e["program_id"]) and h["org_id"] in group
                        for p, group in rules
                    ):
                        continue
                    start = max(e["valid_from"], h["valid_from"])
                    end = min(e["valid_to"] or "9999", h["valid_to"] or "9999")
                    if start < end:
                        eligible.append(
                            {
                                **e,
                                "valid_from": start,
                                "valid_to": None if end == "9999" else end,
                            }
                        )
            eligibility = eligible
        else:
            allowed_orgs = {h["org_id"] for h in history}
        orgs = [
            {**o, "parent_org_id": o["parent_org_id"] if o["parent_org_id"] in allowed_orgs else None}
            for o in orgs if o["org_id"] in allowed_orgs
        ]
        milestones = [
            r
            for r in milestones
            if policy.allows(
                code, r["employee_id"], r["program_id"], min(r["eligible_on"], as_of)
            )
        ]
        if tab == "participation":
            # Only the in-scope side of each interaction is needed for these rates.
            activity = []
            for e in events:
                day = e["at"][:10]
                sender = (
                    e["sender"]
                    if policy.allows(code, e["sender"], e["program"], day)
                    else None
                )
                recipients = [
                    r
                    for r in e["recipients"]
                    if policy.allows(code, r, e["program"], day)
                ]
                if sender or recipients:
                    activity.append(
                        dict(
                            at=e["at"],
                            program=e["program"],
                            sender=sender,
                            recipients=recipients,
                        )
                    )
            events = activity
        else:
            events = [
                e
                for e in events
                if policy.allows(code, e["sender"], e["program"], e["at"][:10])
            ]
        # Team activity is authorized at sender/event grain. Include the display names
        # on those events, without exposing out-of-team directory or assignment records.
        visible = {h["employee_id"] for h in history} | {
            r for e in events for r in e["recipients"]
        }
        people = {k: v for k, v in people.items() if k in visible}
    catalog = catalog_snapshot(
        db,
        tenant,
        codes,
        policy.fields,
        policy.employee if owner == "employee" else None,
        can_view_order_value=policy.can_view_order_value,
    )
    if "U1" in codes:
        login_events = rows(db, """SELECT employee_id, occurred_at FROM user_logins
            WHERE tenant_id=? AND occurred_at <= (SELECT value FROM dataset_metadata WHERE key='data_as_of')
            ORDER BY occurred_at DESC, login_id""", tenant)
        catalog["logins"] = [e for e in login_events if not restricted or
                             policy.allows("U1", e["employee_id"], None, e["occurred_at"][:10])]
    catalog["grants"] = sorted(policy.rules)
    return dict(
        tab=tab,
        tabs=policy.tabs,
        viewer=dict(
            role=owner,
            name=policy.name,
            scope=policy.scope_label(tab),
            can_view_order_value=policy.can_view_order_value,
        ),
        events=events,
        catalog=catalog,
        milestones=milestones,
        milestone_programs=milestone_programs,
        currency=db.execute(
            "SELECT currency FROM tenants WHERE tenant_id=?", (tenant,)
        ).fetchone()[0],
        people=people,
        programs=programs,
        orgs=orgs,
        history=history,
        attribute_keys=attributes,
        observed_through=as_of,
        eligibility=eligibility,
    )


def role_cookie(handler):
    cookie = SimpleCookie()
    try:
        cookie.load(handler.headers.get("Cookie", ""))
    except CookieError:
        raise Problem(400, "Invalid demo session.")
    value = cookie.get("cxs_demo_role")
    owner = value.value if value else "admin"
    if owner not in ROLES:
        raise Problem(403, "Choose a valid demo role.")
    return owner


class Handler(BaseHTTPRequestHandler):
    def reply(self, body, mime, status=200, filename=None, role=None):
        self.send_response(status)
        self.send_header("Content-Type", mime + "; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        if role:
            self.send_header(
                "Set-Cookie", f"cxs_demo_role={role}; Path=/; HttpOnly; SameSite=Strict"
            )
        if filename:
            self.send_header(
                "Content-Disposition", f'attachment; filename="{filename}"'
            )
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        if self.headers.get_content_type() != "application/json":
            raise Problem(415, "Send JSON.")
        size = int(self.headers.get("Content-Length", 0))
        if not 0 < size <= 32768:
            raise Problem(400, "Invalid request size.")
        payload = json.loads(self.rfile.read(size))
        if not isinstance(payload, dict):
            raise Problem(400, "Invalid request.")
        return payload

    def do_GET(self):
        self.handle_request("GET")

    def do_POST(self):
        self.handle_request("POST")

    def handle_request(self, method):
        url = urlsplit(self.path)
        try:
            if method == "GET" and url.path in ASSETS:
                filename, mime = ASSETS[url.path]
                return self.reply((HERE / "build" / filename).read_bytes(), mime)
            if method == "POST" and url.path == "/api/role":
                payload = self.read_json()
                role = payload.get("role")
                if not isinstance(role, str) or role not in ROLES:
                    raise Problem(400, "Choose Admin, Manager, or Employee.")
                return self.reply(
                    json.dumps({"role": role}).encode(), "application/json", role=role
                )
            owner = role_cookie(self)
            with closing(
                sqlite3.connect(DATABASE.as_uri() + "?mode=ro", uri=True)
            ) as db:
                db.row_factory = sqlite3.Row
                if method == "GET" and url.path == "/api/customers":
                    result = dict(
                        role=owner,
                        customers=rows(
                            db, "SELECT tenant_id,name FROM tenants ORDER BY name"
                        ),
                        as_of=db.execute(
                            "SELECT value FROM dataset_metadata WHERE key='data_as_of'"
                        ).fetchone()[0],
                    )
                    for customer in result["customers"]:
                        actor = Permissions(db, customer["tenant_id"], owner)
                        customer.update(
                            tabs=actor.tabs,
                            overview_available=bool(actor.overview_tabs),
                            name_of_viewer=actor.name,
                        )
                else:
                    query = parse_qs(url.query)
                    tenant = query.get("customer", [""])[0]
                    if "role" in query and query["role"] != [owner]:
                        raise Problem(
                            409, "The demo role changed. Reload the workspace."
                        )
                    Permissions(db, tenant, owner)
                    if method == "GET" and url.path == "/api/report":
                        result = snapshot(
                            db, tenant, owner, query.get("tab", [None])[0]
                        )
                    elif method == "GET" and url.path == "/api/workspace":
                        with workspace.connection(workspace.STATE) as state:
                            result = workspace.library(state, tenant, db, owner)
                    elif method == "GET" and url.path in (
                        "/api/download",
                        "/api/email",
                    ):
                        content, filename = workspace.download(
                            db,
                            tenant,
                            query.get("token", [""])[0],
                            email=url.path == "/api/email",
                            owner=owner,
                        )
                        return self.reply(
                            content,
                            "message/rfc822"
                            if url.path == "/api/email"
                            else "text/csv",
                            filename=filename,
                        )
                    elif method == "POST" and url.path == "/api/workspace":
                        result = workspace.mutate(db, tenant, self.read_json(), owner)
                    else:
                        raise workspace.Problem(404, "Unknown route.")
            self.reply(json.dumps(result).encode(), "application/json")
        except (workspace.Problem, ValueError) as err:
            self.reply(
                json.dumps({"error": str(err)}).encode(),
                "application/json",
                getattr(err, "status", 400),
            )

    def log_request(self, code="-", size="-"):
        # Download tokens belong only in the owner's delivery inbox.
        self.log_message("%s %s %s", self.command, urlsplit(self.path).path, code)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    port = parser.parse_args().port
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    workspace.initialize()
    threading.Thread(
        target=workspace.worker,
        args=(DATABASE, snapshot, server.server_port),
        daemon=True,
    ).start()
    print(f"Reporting suite at http://127.0.0.1:{server.server_port}", flush=True)
    server.serve_forever()
