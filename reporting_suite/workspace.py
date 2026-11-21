"""Persistent customer workspaces for the selected demo persona."""

import csv
import io
import json
import os
import re
import secrets
import sqlite3
import smtplib
import subprocess
import threading
import time
import traceback
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formatdate
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = Path(os.environ.get("REPORTING_STATE_DB", HERE / "var/workspaces.sqlite"))
from catalog_data import minimum_group
from permissions import OVERVIEW_SOURCES, Permissions, Problem

WAKE = threading.Event()


@contextmanager
def connection(path):
    with closing(sqlite3.connect(path, timeout=8)) as db:
        db.row_factory = sqlite3.Row
        with db:
            yield db


def initialize():
    STATE.parent.mkdir(parents=True, exist_ok=True)
    with connection(STATE) as db:
        db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY, tenant TEXT NOT NULL, owner TEXT NOT NULL,
                kind TEXT NOT NULL, name TEXT NOT NULL, view TEXT NOT NULL,
                cadence TEXT, weekday INTEGER, clock TEXT, next_run INTEGER, created INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, tenant TEXT NOT NULL, owner TEXT NOT NULL, name TEXT NOT NULL,
                view TEXT NOT NULL, format TEXT NOT NULL, origin TEXT NOT NULL, created INTEGER NOT NULL,
                status TEXT NOT NULL, claim TEXT, started INTEGER, finished INTEGER,
                expires INTEGER, token TEXT UNIQUE, permissions TEXT, content BLOB, error TEXT
            );
            CREATE TABLE IF NOT EXISTS notifications (
                job_id TEXT PRIMARY KEY, message BLOB NOT NULL, retry_at INTEGER,
                attempts INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS jobs_scope ON jobs(tenant,owner,created);
        """)


def access(source, tenant, tab, owner, version=None):
    # Compare older overview files with the sources included when they were generated.
    if version is None:
        version = 4 if tab in ("overview", "teams") else 2
    signature = Permissions(source, tenant, owner).require(
        tab, legacy=version == 1, include_budgets=version >= 3, include_logins=version >= 4
    )
    if tab == "leaders":
        threshold = minimum_group(source)
        # The original fixture exports used a five-person minimum.
        if threshold != 5:
            signature += f":minimum-group={threshold}"
    return signature if version == 1 else f"v{version}:" + signature


def file_version(signature):
    if signature and signature.startswith("v4:"):
        return 4
    if signature and signature.startswith("v3:"):
        return 3
    return 2 if signature and signature.startswith("v2:") else 1


def normalize_catalog_team_view(source, view, *, stored=False):
    if view["tab"] not in ("performance", "leaders", "investigation"):
        return view
    options = dict(view["options"])
    filters = dict(view["filters"])
    has_page = "managerPath" in options or "pageMode" in options
    if not has_page:
        options["managerPath"] = filters.pop("hierarchy", "")
        options["pageMode"] = filters.pop("hierarchyMode", "team")
    # Legacy catalog settings overrode any shared filters left over from other tabs.
    if (stored and not has_page) or options.keys() & {"dateMode", "start", "end", "org", "program"}:
        start, end = "2026-10-01", "2026-10-31"
        if view["tab"] == "investigation":
            if source is None:
                return view
            start = "2026-01-01"
            end = source.execute("SELECT value FROM dataset_metadata WHERE key='data_as_of'").fetchone()[0][:10]
            # Approval history did not support a comparison before named team pages.
            filters.update(compare="off", comparisonStart="", comparisonEnd="")
        filters.update(period=options.pop("dateMode", "custom"),
                       start=options.pop("start", start), end=options.pop("end", end),
                       org=options.pop("org", ""), program=options.pop("program", ""))
    return {**view, "options": options, "filters": filters}


def check_view_filters(source, tenant, owner, view):
    filters = view["filters"]
    team_page = view["tab"] == "teams" or (
        view["tab"] in ("participation", "activity", "categories", "performance", "leaders", "investigation", "logins") and
        ("managerPath" in view["options"] or "pageMode" in view["options"])
    )
    location = view["options"] if team_page else filters
    path = location.get("managerPath" if team_page else "hierarchy")
    if team_page and (filters.get("hierarchy") or filters.get("hierarchyMode")):
        raise Problem(400, "Choose a team report page.")
    if path:
        policy = Permissions(source, tenant, owner)
        tabs = policy.overview_tabs if view["tab"] in ("overview", "teams") else [view["tab"]]
        for tab in tabs:
            if not any(h["hierarchy"] == path for h in policy.assignment_history(source, tenant, tab)):
                raise Problem(403, "This reporting hierarchy is unavailable for the selected role.")
    if location.get("pageMode" if team_page else "hierarchyMode", "team") not in ("team", "individual"):
        raise Problem(400, "Choose a valid hierarchy scope.")
    requested = {
        key for key, value in filters.items() if key.startswith("attribute:") and value
    }
    requested.update(
        "attribute:" + key.removeprefix("unassigned:")
        for key, value in filters.items()
        if key.startswith("unassigned:") and value
    )
    if filters.get("breakdown"):
        requested.add("attribute:" + filters["breakdown"])
    if requested and not requested.issubset(Permissions(source, tenant, owner).fields):
        raise Problem(403, "An employee attribute in this view is unavailable.")


def validate_dates(start, end, as_of, label):
    try:
        for value in (start, end):
            if datetime.strptime(value, "%Y-%m-%d").date().isoformat() != value:
                raise ValueError
    except ValueError:
        raise Problem(400, f"Choose valid {label} dates.")
    if not "2026-01-01" <= start <= end <= as_of:
        raise Problem(
            400,
            f"Choose {label} dates between 2026-01-01 and {as_of}, with the end on or after the start.",
        )


def clean_view(source, tenant, view, owner):
    if not isinstance(view, dict) or not isinstance(view.get("tab"), str):
        raise Problem(400, "Choose a report.")
    access(source, tenant, view["tab"], owner)
    for field in ("filters", "options"):
        values = view.get(field)
        if not isinstance(values, dict) or len(values) > 120:
            raise Problem(400, "Invalid view settings.")
        for key, value in values.items():
            if key.startswith("columns:") and field == "options":
                if isinstance(value, list) and all(isinstance(h, str) for h in value):
                    continue
                raise Problem(400, "Invalid table columns.")
            if not isinstance(value, str) or len(value) > 500:
                raise Problem(400, "Invalid filter.")
    view = normalize_catalog_team_view(source, view)
    filters = view["filters"]
    if "runDay" in filters:
        raise Problem(400, "Rolling dates are calculated by the report runner.")
    check_view_filters(source, tenant, owner, view)
    comparison = filters.get("compare", "off")
    if comparison not in ("off", "previous", "custom"):
        raise Problem(400, "Choose a valid comparison period.")
    period = filters.get("period", "2026-10")
    as_of = source.execute(
        "SELECT value FROM dataset_metadata WHERE key='data_as_of'"
    ).fetchone()[0][:10]
    period_report = view["tab"] in (
        "overview",
        "teams",
        "activity",
        "categories",
        "performance",
        "leaders",
        "investigation",
        "logins",
        "participation",
    )
    milestone_period = (
        filters.get("eligibilityPeriod", "any")
        if view["tab"] in ("awards", "upcoming", "nonresponders")
        else "any"
    )
    if milestone_period != "any":
        period = milestone_period
    uses_period = period_report or milestone_period != "any"
    if uses_period and period not in (
        "last7",
        "last30",
        "last90",
        "2026-09",
        "2026-10",
        "2026-11",
        "custom",
        "all",
    ):
        raise Problem(400, "Choose a valid reporting period.")
    if uses_period and period == "custom":
        start, end = filters.get("start", ""), filters.get("end", "")
    elif (
        view["options"].get("dateMode", "custom") == "custom"
        and not period_report
        and view["tab"]
        not in (
            "awards",
            "upcoming",
            "nonresponders",
        )
    ):
        end = view["options"].get("end", as_of)
        start = view["options"].get("start", "2026-01-01")
    else:
        start = end = as_of
    validate_dates(start, end, as_of, "report")
    if comparison == "custom":
        if view["tab"] not in ("overview", "teams", "categories", "performance", "leaders", "investigation", *OVERVIEW_SOURCES):
            raise Problem(400, "This report does not support a comparison period.")
        if view["tab"] == "awards" and milestone_period == "any":
            raise Problem(400, "Choose an eligibility period to compare awards.")
        validate_dates(
            filters.get("comparisonStart", ""),
            filters.get("comparisonEnd", ""),
            as_of,
            "comparison",
        )
    if view["options"].get("dateMode", "custom") not in (
        "custom",
        "last7",
        "last30",
        "last90",
    ):
        raise Problem(400, "Choose a valid date range.")
    tag = view.get("tag")
    if tag is not None and (
        not isinstance(tag, dict)
        or tag.get("kind") not in ("value", "category")
        or not isinstance(tag.get("label"), str)
    ):
        raise Problem(400, "Invalid recognition tag.")
    return json.dumps(
        {k: view.get(k) for k in ("tab", "options", "filters", "tag")},
        separators=(",", ":"),
    )


def next_run(cadence, clock, weekday, now):
    today = datetime.fromtimestamp(now, timezone.utc)
    hour, minute = map(int, clock.split(":"))
    target = today.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if cadence == "weekly":
        target += timedelta(days=(weekday - target.weekday()) % 7)
    if target <= today:
        target += timedelta(days=7 if cadence == "weekly" else 1)
    return int(target.timestamp())


def queue(db, tenant, name, view, fmt, origin, now, owner):
    ident = secrets.token_urlsafe(12)
    db.execute(
        """INSERT INTO jobs(id,tenant,owner,name,view,format,origin,created,status)
        VALUES(?,?,?,?,?,?,?,?,'queued')""",
        (ident, tenant, owner, name, view, fmt, origin, now),
    )
    return ident


def library(db, tenant, source=None, owner="admin"):
    grants = {}

    def permissions(tab, version=None):
        key = (tab, version)
        if key not in grants:
            try:
                grants[key] = access(source, tenant, tab, owner, version)
            except Problem:
                grants[key] = None
        return grants[key]

    items = [
        dict(r)
        for r in db.execute(
            """SELECT id,name,kind,view,cadence,weekday,clock,next_run
        FROM items WHERE tenant=? AND owner=? ORDER BY created DESC,rowid DESC""",
            (tenant, owner),
        )
    ]
    for item in items:
        item["view"] = normalize_catalog_team_view(source, json.loads(item["view"]), stored=True)
        item["available"] = (
            source is None or permissions(item["view"]["tab"]) is not None
        )
        if item["available"] and source is not None:
            try:
                check_view_filters(source, tenant, owner, item["view"])
            except Problem:
                item["available"] = False
    jobs = [
        dict(r)
        for r in db.execute(
            """SELECT id,name,format,origin,created,status,finished,expires,error,
        json_extract(view,'$.tab') AS tab,token,permissions FROM jobs WHERE tenant=? AND owner=? ORDER BY created DESC,rowid DESC""",
            (tenant, owner),
        )
    ]
    for job in jobs:
        generated_with = job.pop("permissions")
        if (
            source is not None
            and job["status"] == "ready"
            and generated_with != permissions(job["tab"], file_version(generated_with))
        ):
            job.update(status="unavailable", token=None)
        if job["expires"] and job["expires"] <= time.time():
            job.update(status="expired", token=None)
    return dict(items=items, jobs=jobs)


def mutate(source, tenant, payload, owner="admin"):
    action = payload.get("action")
    now = int(time.time())
    with connection(STATE) as db:
        db.execute("BEGIN IMMEDIATE")
        if action in ("save", "schedule", "export", "rename"):
            name = payload.get("name")
            if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
                raise Problem(400, "Enter a name of up to 100 characters.")
            name = name.strip()
        if action in ("save", "schedule", "export"):
            view = clean_view(source, tenant, payload.get("view"), owner)
            if action == "export":
                fmt = payload.get("format", "report")
                if fmt != "report" and not (
                    fmt == "recipients" and payload["view"]["tab"] == "activity"
                ):
                    raise Problem(400, "Choose a supported export format.")
                queue(db, tenant, name, view, fmt, "Manual", now, owner)
            else:
                cadence = clock = weekday = due = None
                if action == "schedule":
                    cadence, clock, weekday = (
                        payload.get(k) for k in ("cadence", "clock", "weekday")
                    )
                    if (
                        cadence not in ("daily", "weekly")
                        or not isinstance(clock, str)
                        or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", clock)
                        or type(weekday) is not int
                        or not 0 <= weekday <= 6
                    ):
                        raise Problem(400, "Choose a valid delivery time.")
                    due = next_run(cadence, clock, weekday, now)
                db.execute(
                    "INSERT INTO items VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        secrets.token_urlsafe(12),
                        tenant,
                        owner,
                        action,
                        name,
                        view,
                        cadence,
                        weekday,
                        clock,
                        due,
                        now,
                    ),
                )
        elif action in ("delete", "rename", "run", "pause", "resume"):
            if not isinstance(payload.get("id"), str):
                raise Problem(400, "Choose a saved view or schedule.")
            row = db.execute(
                "SELECT * FROM items WHERE id=? AND tenant=? AND owner=?",
                (payload.get("id"), tenant, owner),
            ).fetchone()
            if not row:
                raise Problem(404, "This item is unavailable for this customer.")
            if action == "delete":
                db.execute("DELETE FROM items WHERE id=?", (row["id"],))
            elif action == "rename":
                db.execute("UPDATE items SET name=? WHERE id=?", (name, row["id"]))
            elif row["kind"] != "schedule":
                raise Problem(400, "Choose a scheduled report.")
            elif action == "run":
                access(source, tenant, json.loads(row["view"])["tab"], owner)
                queue(
                    db,
                    tenant,
                    row["name"],
                    row["view"],
                    "report",
                    "Scheduled",
                    now,
                    owner,
                )
            else:
                if action == "resume":
                    access(source, tenant, json.loads(row["view"])["tab"], owner)
                due = (
                    next_run(row["cadence"], row["clock"], row["weekday"], now)
                    if action == "resume"
                    else None
                )
                db.execute("UPDATE items SET next_run=? WHERE id=?", (due, row["id"]))
        else:
            raise Problem(400, "Unknown workspace action.")
        result = library(db, tenant, source, owner)
    WAKE.set()
    return result


class ReportTables(HTMLParser):
    """Read the export renderer's section headings and semantic tables."""

    def __init__(self):
        super().__init__()
        self.rows = []
        self.cell = None
        self.row = []
        self.tables = 0
        self.filters = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if values.get("data-filter") and values.get("data-value"):
            self.filters.append([values["data-filter"], values["data-value"]])
        if tag == "table":
            self.tables += 1
        if tag == "tr":
            self.row = []
        if tag in ("h2", "th", "td"):
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "th", "h2") and self.cell is not None:
            value = "".join(self.cell).strip()
            self.cell = None
            if tag == "h2":
                self.rows.extend([[], [value]])
            else:
                self.row.append(value)
        if tag == "tr":
            self.rows.append(self.row)


def make_csv(source, snapshot, job):
    tenant, owner = job["tenant"], job["owner"]
    view = normalize_catalog_team_view(source, json.loads(job["view"]), stored=True)
    permissions = access(source, tenant, view["tab"], owner)
    as_of = source.execute(
        "SELECT value FROM dataset_metadata WHERE key='data_as_of'"
    ).fetchone()[0]
    data = snapshot(source, tenant, owner, view["tab"])
    check_view_filters(source, tenant, owner, view)
    # Pin retries to the UTC day this delivery was queued.
    run_day = (
        datetime.fromtimestamp(dict(job).get("created", time.time()), timezone.utc)
        .date()
        .isoformat()
    )
    payload = dict(
        data=data, view=view, asOf=as_of[:10], runDay=run_day, output=job["format"]
    )
    rendered = subprocess.run(
        ["node", str(HERE / "build-worker/app.js")],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=True,
        timeout=45,
    )
    parsed = ReportTables()
    parsed.feed(rendered.stdout)
    if not parsed.tables:
        raise Problem(400, "Check the reporting period and try again.")
    contents = io.StringIO(newline="")
    writer = csv.writer(contents)
    rows = parsed.rows
    if job["format"] == "report":
        name = source.execute(
            "SELECT name FROM tenants WHERE tenant_id=?", (tenant,)
        ).fetchone()[0]
        rows = [
            ["Report", job["name"]],
            ["Customer", name],
            ["Role", owner.title()],
            ["Access scope", data["viewer"]["scope"]],
            ["Data as of (UTC)", as_of],
            ["Currency", data["currency"]],
            *parsed.filters,
            *rows,
        ]
    else:
        # Keep raw extracts rectangular so they can be imported directly into a spreadsheet.
        paths = [(key, value) for key, value in parsed.filters
                 if key in ("Reporting hierarchy", "Organization path")]
        rows = [
            [*r, "Customer", "Data as of (UTC)", *(k for k, _ in paths)]
            if i == 0 else [*r, tenant, as_of, *(v for _, v in paths)]
            for i, r in enumerate(rows)
        ]
    for row in rows:
        # Avoid treating names, messages and other free text as spreadsheet formulas.
        writer.writerow(
            [
                "'" + v
                if v.lstrip().startswith(("=", "+", "-", "@"))
                and not re.fullmatch(r"[+-]?\$?[\d,.]+(?:%| pp)?", v)
                else v
                for v in row
            ]
        )
    return contents.getvalue().encode("utf-8-sig"), permissions


def ready_email(job, token, finished, port):
    message = EmailMessage()
    message["To"] = f"{job['owner']}+{job['tenant']}@example.invalid"
    message["From"] = "CXS Recognize <reports@example.invalid>"
    message["Date"] = formatdate(finished, usegmt=True)
    message["Message-ID"] = f"<{job['id']}@reports.example.invalid>"
    message["Subject"] = "Report ready · " + " ".join(job["name"].splitlines())
    link = (
        f"http://127.0.0.1:{port}/api/download?customer={job['tenant']}&token={token}"
    )
    message.set_content(
        f"Your {job['name']} CSV is ready. The download link expires in 24 hours.\n\n{link}\n"
    )
    return message.as_bytes()


def relay_one(source_path):
    """Optionally send the local inbox's notification to a loopback SMTP capture server."""
    smtp_port = os.environ.get("REPORTING_SMTP_PORT")
    if not smtp_port:
        return False
    now = int(time.time())
    with connection(STATE) as db:
        db.execute("BEGIN IMMEDIATE")
        mail = db.execute(
            """SELECT n.*,j.tenant,j.token,j.owner FROM notifications n JOIN jobs j ON n.job_id=j.id
            WHERE n.retry_at<=? AND j.status='ready' AND j.expires>? ORDER BY n.retry_at LIMIT 1""",
            (now, now),
        ).fetchone()
        if not mail:
            return False
        db.execute(
            "UPDATE notifications SET attempts=attempts+1,retry_at=? WHERE job_id=?",
            (now + 120, mail["job_id"]),
        )
    try:
        with closing(
            sqlite3.connect(source_path.as_uri() + "?mode=ro", uri=True)
        ) as source:
            download(source, mail["tenant"], mail["token"], owner=mail["owner"])
        with smtplib.SMTP("127.0.0.1", int(smtp_port), timeout=5) as smtp:
            smtp.sendmail(
                "reports@example.invalid",
                f"{mail['owner']}+{mail['tenant']}@example.invalid",
                mail["message"],
            )
    except (OSError, smtplib.SMTPException):
        return False
    except Problem:
        pass
    with connection(STATE) as db:
        db.execute(
            "UPDATE notifications SET retry_at=NULL WHERE job_id=?", (mail["job_id"],)
        )
    return True


def tick(source_path, snapshot, port=8765):
    now = int(time.time())
    claim = secrets.token_hex(12)
    with connection(STATE) as db:
        db.execute("BEGIN IMMEDIATE")
        for row in db.execute(
            "SELECT * FROM items WHERE next_run<=?", (now,)
        ).fetchall():
            queue(
                db,
                row["tenant"],
                row["name"],
                row["view"],
                "report",
                "Scheduled",
                now,
                row["owner"],
            )
            due = next_run(row["cadence"], row["clock"], row["weekday"], now)
            db.execute("UPDATE items SET next_run=? WHERE id=?", (due, row["id"]))
        db.execute(
            "UPDATE jobs SET status='expired',content=NULL,token=NULL WHERE status='ready' AND expires<=?",
            (now,),
        )
        job = db.execute(
            """SELECT * FROM jobs WHERE status='queued' OR (status='running' AND started<?)
            ORDER BY created,rowid LIMIT 1""",
            (now - 120,),
        ).fetchone()
        if not job:
            return False
        db.execute(
            "UPDATE jobs SET status='running',started=?,claim=? WHERE id=?",
            (now, claim, job["id"]),
        )
    try:
        with closing(
            sqlite3.connect(source_path.as_uri() + "?mode=ro", uri=True)
        ) as source:
            source.row_factory = sqlite3.Row
            content, perms = make_csv(source, snapshot, job)
            if perms != access(
                source, job["tenant"], json.loads(job["view"])["tab"], job["owner"]
            ):
                raise Problem(403, "Permissions changed. Request a new export.")
        finished = int(time.time())
        token = secrets.token_urlsafe(32)
        with connection(STATE) as db:
            updated = db.execute(
                """UPDATE jobs SET status='ready',content=?,permissions=?,finished=?,expires=?,token=?
                WHERE id=? AND claim=?""",
                (
                    content,
                    perms,
                    finished,
                    finished + 86400,
                    token,
                    job["id"],
                    claim,
                ),
            )
            if updated.rowcount:
                db.execute(
                    "INSERT INTO notifications(job_id,message,retry_at) VALUES (?,?,?)",
                    (
                        job["id"],
                        ready_email(job, token, finished, port),
                        finished if os.environ.get("REPORTING_SMTP_PORT") else None,
                    ),
                )
    except Exception as e:
        if not isinstance(e, Problem):
            traceback.print_exc()
        with connection(STATE) as db:
            db.execute(
                "UPDATE jobs SET status='failed',error=?,finished=? WHERE id=? AND claim=?",
                (
                    str(e)
                    if isinstance(e, Problem)
                    else "Could not generate the CSV. Request a new export.",
                    int(time.time()),
                    job["id"],
                    claim,
                ),
            )
    return True


def worker(source_path, snapshot, port):
    while True:
        try:
            relayed = relay_one(source_path)
            if tick(source_path, snapshot, port) or relayed:
                continue
        except Exception:
            traceback.print_exc()
        WAKE.wait(2)
        WAKE.clear()


def download(source, tenant, token, email=False, owner="admin"):
    with connection(STATE) as db:
        row = db.execute(
            "SELECT * FROM jobs WHERE tenant=? AND owner=? AND token=?",
            (tenant, owner, token),
        ).fetchone()
        if not row or row["status"] != "ready" or row["expires"] <= time.time():
            raise Problem(404, "This download link is unavailable or expired.")
        tab = json.loads(row["view"])["tab"]
        if (
            access(source, tenant, tab, owner, file_version(row["permissions"]))
            != row["permissions"]
        ):
            raise Problem(403, "Permissions changed. Request a new export.")
        if email:
            note = db.execute(
                "SELECT message FROM notifications WHERE job_id=?", (row["id"],)
            ).fetchone()
            if not note:
                raise Problem(404, "No email available for this export.")
            return note[0], f"{tenant}-{tab}-{row['id']}.eml"
        return row["content"], f"{tenant}-{tab}-{row['id']}.csv"
