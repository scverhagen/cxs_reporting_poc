"""Regression checks for customer isolation, export parity and scheduled delivery."""

import csv
import hashlib
import io
import json
import shutil
import sqlite3
import tempfile
import time
import unittest
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from pathlib import Path
from unittest.mock import patch

import workspace as ws
from app import DATABASE, snapshot
from permissions import Permissions


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        self.source_path = root / "source.sqlite"
        shutil.copyfile(DATABASE, self.source_path)
        self.source = sqlite3.connect(self.source_path)
        self.source.row_factory = sqlite3.Row
        self.addCleanup(self.source.close)
        state = patch.object(ws, "STATE", root / "workspace.sqlite")
        state.start()
        self.addCleanup(state.stop)
        ws.initialize()

    def commit_action(self, tenant, action, tab="activity", **args):
        view = dict(tab=tab, filters={}, options={}, tag=None)
        return ws.mutate(
            self.source, tenant, dict(action=action, view=view, name="Sample", **args)
        )

    def test_recipient_exports_and_customer_switch(self):
        manifest = json.loads(DATABASE.with_suffix(".manifest.json").read_text())
        for scenario in manifest["scenarios"]:
            tenant = scenario["tenant_id"]
            expected = scenario["october_approved_events"]
            points = scenario["october_approved_points"]
            with self.subTest(tenant=tenant):
                self.assertEqual(self.commit_action(tenant, "save")["jobs"], [])
                self.commit_action(tenant, "export", format="recipients")
                self.assertTrue(ws.tick(self.source_path, snapshot))
                with ws.connection(ws.STATE) as db:
                    library = ws.library(db, tenant)
                self.assertEqual(len(library["items"]), 1)
                self.assertEqual(len(library["jobs"]), 1)
                token = library["jobs"][0]["token"]
                contents, _ = ws.download(self.source, tenant, token)
                rows = list(csv.DictReader(io.StringIO(contents.decode("utf-8-sig"))))
                self.assertEqual(len({r["Recognition ID"] for r in rows}), expected)
                self.assertEqual(sum(int(r["Recipient points"]) for r in rows), points)
                private = {
                    r[0]
                    for r in self.source.execute(
                        "SELECT recognition_id FROM recognitions WHERE tenant_id=? AND is_private",
                        (tenant,),
                    )
                }
                self.assertTrue(any(r["Recognition ID"] in private for r in rows))
                self.assertTrue(
                    all(
                        not r["Message"] for r in rows if r["Recognition ID"] in private
                    )
                )
                other = "harbor" if tenant != "harbor" else "atlas"
                with self.assertRaises(ws.Problem):
                    ws.download(self.source, other, token)
                with self.assertRaises(ws.Problem):
                    self.commit_action(other, "delete", id=library["items"][0]["id"])

    def test_due_jobs_pause_catchup_and_expiration(self):
        result = self.commit_action(
            "harbor", "schedule", "awards", cadence="daily", weekday=0, clock="09:00"
        )
        ident = result["items"][0]["id"]
        self.commit_action("harbor", "pause", id=ident)
        self.assertFalse(ws.tick(self.source_path, snapshot))
        self.commit_action("harbor", "resume", id=ident)
        with ws.connection(ws.STATE) as db:
            db.execute("UPDATE items SET next_run=1 WHERE id=?", (ident,))
        self.assertTrue(ws.tick(self.source_path, snapshot))
        self.assertFalse(ws.tick(self.source_path, snapshot))
        with ws.connection(ws.STATE) as db:
            library = ws.library(db, "harbor")
        self.assertGreater(library["items"][0]["next_run"], time.time())
        (job,) = library["jobs"]
        content, _ = ws.download(self.source, "harbor", job["token"])
        self.assertIn("Total awards,13,", content.decode())
        self.assertIn("Outstanding,5,", content.decode())
        self.assertEqual(job["origin"], "Scheduled")
        with ws.connection(ws.STATE) as db:
            db.execute("UPDATE jobs SET expires=1")
        with self.assertRaises(ws.Problem):
            ws.download(self.source, "harbor", job["token"])
        ws.tick(self.source_path, snapshot)
        with ws.connection(ws.STATE) as db:
            self.assertEqual(ws.library(db, "harbor")["jobs"][0]["status"], "expired")

    def test_restricted_report_and_field_revocation(self):
        with self.assertRaises(ws.Problem):
            self.commit_action("atlas", "export", "financial")
        self.commit_action("cedar", "export", "financial")
        ws.tick(self.source_path, snapshot)
        with ws.connection(ws.STATE) as db:
            (job,) = ws.library(db, "cedar")["jobs"]
        body, _ = ws.download(self.source, "cedar", job["token"])
        self.assertIn("Taxable benefit,$1.32", body.decode())
        self.commit_action("cedar", "export", "financial")
        self.source.execute(
            "DELETE FROM field_grants WHERE tenant_id='cedar' AND field_name='financial_allocations'"
        )
        self.source.commit()
        with self.assertRaises(ws.Problem):
            ws.download(self.source, "cedar", job["token"])
        ws.tick(self.source_path, snapshot)
        with ws.connection(ws.STATE) as db:
            self.assertEqual(ws.library(db, "cedar")["jobs"][0]["status"], "failed")

    def test_local_email_delivery(self):
        with patch.dict("os.environ", {"REPORTING_SMTP_PORT": "1025"}):
            self.commit_action("harbor", "export", "awards")
            ws.tick(self.source_path, snapshot, port=18765)
            with ws.connection(ws.STATE) as db:
                (job,) = ws.library(db, "harbor")["jobs"]
            message, _ = ws.download(self.source, "harbor", job["token"], email=True)
            email = BytesParser(policy=policy.default).parsebytes(message)
            self.assertEqual(email["To"], "admin+harbor@example.invalid")
            self.assertIn(
                "127.0.0.1:18765/api/download?customer=harbor&token=" + job["token"],
                email.get_content(),
            )
            with patch.object(ws.smtplib, "SMTP") as transport:
                self.assertTrue(ws.relay_one(self.source_path))
                self.assertFalse(ws.relay_one(self.source_path))
                transport.return_value.__enter__.return_value.sendmail.assert_called_once_with(
                    "reports@example.invalid", "admin+harbor@example.invalid", message
                )
            with self.assertRaises(ws.Problem):
                ws.download(self.source, "cedar", job["token"], email=True)

    def test_role_scopes_for_all_customers(self):
        for (tenant,) in self.source.execute("SELECT tenant_id FROM tenants"):
            with self.subTest(tenant=tenant):
                teams = snapshot(self.source, tenant, "manager", "awards")
                self.assertEqual(
                    set(teams["tabs"]),
                    {
                        "activity",
                        "categories",
                        "participation",
                        "awards",
                        "upcoming",
                        "nonresponders",
                        "logins",
                    },
                )
                self.assertEqual(
                    {o["org_id"] for o in teams["orgs"]},
                    {"north", "engineering", "operations"},
                )
                self.assertEqual(len(teams["milestones"]), 3)
                self.assertFalse(teams["events"])
                activity = snapshot(self.source, tenant, "manager", "activity")
                actual = {e["id"] for e in activity["events"]}
                expected = {
                    r[0]
                    for r in self.source.execute(
                        """SELECT r.recognition_id FROM v_official_recognition r
                    JOIN employee_history h ON r.tenant_id=h.tenant_id AND r.sender_id=h.employee_id
                    WHERE r.tenant_id=? AND h.org_id IN ('north','operations','engineering')
                    AND substr(r.activity_at,1,10)>=h.valid_from AND (h.valid_to IS NULL OR substr(r.activity_at,1,10)<h.valid_to)""",
                        (tenant,),
                    )
                }
                self.assertEqual(actual, expected)
                self.assertTrue(all(e["message"] is None for e in activity["events"]))
                for tab, key in (("orders", "orders"), ("wallets", "wallet")):
                    personal = snapshot(self.source, tenant, "employee", tab)
                    self.assertEqual(set(personal["people"]), {"e09"})
                    self.assertEqual(
                        {r["employee_id"] for r in personal["catalog"][key]}, {"e09"}
                    )
                    self.assertEqual(
                        set(personal["catalog"]), {"grants", "minimum_group", key}
                    )
                for role, blocked in (
                    ("manager", "wallets"),
                    ("employee", "activity"),
                    ("employee", "leaders"),
                ):
                    with self.assertRaises(ws.Problem):
                        snapshot(self.source, tenant, role, blocked)
                    with self.assertRaises(ws.Problem):
                        ws.mutate(
                            self.source,
                            tenant,
                            dict(
                                action="export",
                                name="Test",
                                view=dict(tab=blocked, filters={}, options={}),
                            ),
                            role,
                        )

    def test_personal_workspace_and_automatic_delivery(self):
        role = "employee"
        args = dict(
            name="My orders", view=dict(tab="orders", filters={}, options={}, tag=None)
        )
        ws.mutate(self.source, "cedar", dict(action="save", **args), role)
        saved = ws.mutate(
            self.source,
            "cedar",
            dict(action="schedule", cadence="daily", clock="08:00", weekday=0, **args),
            role,
        )
        schedule = next(i for i in saved["items"] if i["kind"] == "schedule")
        for other in ("manager", "admin"):
            with ws.connection(ws.STATE) as db:
                self.assertEqual(
                    ws.library(db, "cedar", self.source, other)["items"], []
                )
            for action in ("run", "pause", "delete"):
                with self.assertRaises(ws.Problem):
                    ws.mutate(
                        self.source,
                        "cedar",
                        dict(action=action, id=schedule["id"]),
                        other,
                    )
        with ws.connection(ws.STATE) as db:
            db.execute("UPDATE items SET next_run=1 WHERE id=?", (schedule["id"],))
        ws.tick(self.source_path, snapshot)
        with ws.connection(ws.STATE) as db:
            (job,) = ws.library(db, "cedar", self.source, role)["jobs"]
        file, _ = ws.download(self.source, "cedar", job["token"], owner=role)
        self.assertIn("o-points-delivered", file.decode())
        self.assertNotIn("o-points-canceled", file.decode())
        email, _ = ws.download(
            self.source, "cedar", job["token"], email=True, owner=role
        )
        self.assertIn(b"employee+cedar@example.invalid", email)
        for other in ("admin", "manager"):
            with self.assertRaises(ws.Problem):
                ws.download(self.source, "cedar", job["token"], owner=other)
        self.source.execute(
            "DELETE FROM report_grants WHERE tenant_id='cedar' AND user_id='employee' AND report_id='O1'"
        )
        self.source.commit()
        with self.assertRaises(ws.Problem):
            ws.download(self.source, "cedar", job["token"], owner=role)

    def test_dashboard_drill_filters_survive_csv_generation(self):
        dates = {"start": "2026-10-03", "end": "2026-10-23", "org": "engineering"}
        for tenant, owner, tab, filters, options in (
            (
                "harbor",
                "manager",
                "awards",
                {**dates, "eligibilityPeriod": "custom"},
                {},
            ),
            ("cedar", "employee", "wallets", {}, dates),
        ):
            with self.subTest(tab=tab):
                view = dict(tab=tab, filters=filters, options=options, tag=None)
                ws.mutate(
                    self.source,
                    tenant,
                    dict(action="export", name=tab, view=view),
                    owner,
                )
                self.assertTrue(ws.tick(self.source_path, snapshot))
                with ws.connection(ws.STATE) as db:
                    (job,) = ws.library(db, tenant, self.source, owner)["jobs"]
                body, _ = ws.download(self.source, tenant, job["token"], owner=owner)
                rows = list(csv.reader(io.StringIO(body.decode("utf-8-sig"))))
                if tab == "awards":
                    self.assertIn(["Eligible from", dates["start"]], rows)
                    self.assertIn(["Eligible through", dates["end"]], rows)
                    self.assertIn(
                        ["Total awards", "3", "All milestone entitlements"], rows
                    )
                else:
                    self.assertIn(["Trend from", dates["start"]], rows)
                    self.assertIn(["Balance as of", dates["end"]], rows)
                    header = rows.index(["Date", "Closing points balance"])
                    self.assertEqual(rows[header + 1][0], dates["start"])
                    self.assertEqual(rows[header + 21][0], dates["end"])

    def test_order_values_and_legacy_downloads(self):
        tenant = "summit"
        for owner in ("employee", "admin"):
            data = snapshot(self.source, tenant, owner, "orders")
            orders = data["catalog"]["orders"]
            self.assertTrue(orders)
            self.assertTrue(any(o["items"] for o in orders))
            for order in orders:
                self.assertEqual("value_minor" in order, owner == "admin")
                for item in order["items"]:
                    self.assertEqual("unit_value_minor" in item, owner == "admin")
            args = dict(
                action="export",
                name="Order activity",
                view=dict(tab="orders", filters={}, options={}),
            )
            ws.mutate(self.source, tenant, args, owner)
            self.assertTrue(ws.tick(self.source_path, snapshot))
            with ws.connection(ws.STATE) as db:
                (job,) = ws.library(db, tenant, self.source, owner)["jobs"]
            contents, _ = ws.download(self.source, tenant, job["token"], owner=owner)
            for label in (b"Gross value", b"Order value", b"$"):
                self.assertEqual(label in contents, owner == "admin")

        # Simulate an employee file created by the previous order projection.
        policy = Permissions(self.source, tenant, "employee")
        previous = [policy.fields, policy.employee, policy.rules["O1"], policy.history]
        digest = hashlib.sha256(
            json.dumps(previous, sort_keys=True).encode()
        ).hexdigest()
        with ws.connection(ws.STATE) as db:
            db.execute(
                "UPDATE jobs SET permissions=? WHERE owner='employee'", (digest,)
            )
            (old,) = ws.library(db, tenant, self.source, "employee")["jobs"]
            self.assertEqual(old["status"], "unavailable")
            token = db.execute(
                "SELECT token FROM jobs WHERE owner='employee'"
            ).fetchone()[0]
        for email in (True, False):
            with self.assertRaises(ws.Problem):
                ws.download(self.source, tenant, token, email=email, owner="employee")

    def test_overview_filters_grants_and_scheduled_delivery(self):
        tenant = "harbor"
        filters = dict(
            period="custom", start="2026-10-03", end="2026-10-23", org="engineering"
        )
        view = dict(tab="overview", filters=filters, options={}, tag=None)
        args = dict(name="Engineering overview", view=view)
        for owner, sections in (
            ("admin", {"activity", "participation", "wallets", "orders", "awards", "funding", "logins"}),
            ("manager", {"activity", "participation", "awards", "logins"}),
            ("employee", {"wallets", "orders", "awards", "logins"}),
        ):
            with self.subTest(owner=owner):
                overview = snapshot(self.source, tenant, owner, "overview")
                self.assertEqual(set(overview["reports"]), sections)
                for tab, report in overview["reports"].items():
                    self.assertEqual(report, snapshot(self.source, tenant, owner, tab))
                lib = ws.mutate(self.source, tenant, dict(action="save", **args), owner)
                self.assertEqual(lib["items"][0]["view"], view)
                lib = ws.mutate(
                    self.source,
                    tenant,
                    dict(
                        action="schedule",
                        cadence="daily",
                        clock="01:00",
                        weekday=0,
                        **args,
                    ),
                    owner,
                )
                schedule = next(i for i in lib["items"] if i["kind"] == "schedule")
                self.assertEqual(schedule["view"], view)
                ws.mutate(
                    self.source, tenant, dict(action="run", id=schedule["id"]), owner
                )
                self.assertTrue(ws.tick(self.source_path, snapshot))
                with ws.connection(ws.STATE) as db:
                    (job,) = ws.library(db, tenant, self.source, owner)["jobs"]
                token = job["token"]
                content, _ = ws.download(self.source, tenant, token, owner=owner)
                rows = list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))
                self.assertIn(["From", filters["start"]], rows)
                self.assertIn(["Through", filters["end"]], rows)
                self.assertIn(["Organization", "Engineering"], rows)
                self.assertIn(["Reporting period", "Custom dates"], rows)
                self.assertEqual(
                    any(r and r[0] == "Order value" for r in rows), owner == "admin"
                )
                for tab, title in (
                    ("logins", "Logins over time"),
                    ("orders", "Orders over time"),
                    ("activity", "Recognition over time"),
                    ("wallets", "Points balance over time"),
                    ("funding", "Award spending over time"),
                    ("funding", "Budget balance over time"),
                    ("awards", "Milestone awards by status"),
                    ("participation", "Participation by program"),
                ):
                    self.assertEqual([title] in rows, tab in sections)
                if owner == "manager":
                    self.assertIn(
                        ["Milestone awards", "3", "Eligible during period"], rows
                    )
                with self.assertRaises(ws.Problem):
                    ws.download(self.source, "cedar", token, owner=owner)
                with self.assertRaises(ws.Problem):
                    ws.download(
                        self.source,
                        tenant,
                        token,
                        owner="manager" if owner == "admin" else "admin",
                    )
        # A scheduled overview uses remaining grants on its next run.
        self.source.execute(
            "DELETE FROM report_grants WHERE tenant_id=? AND user_id='employee' AND report_id='O1'",
            (tenant,),
        )
        self.source.commit()
        with self.assertRaises(ws.Problem):
            ws.download(self.source, tenant, token, owner="employee")
        ws.mutate(
            self.source, tenant, dict(action="run", id=schedule["id"]), "employee"
        )
        self.assertTrue(ws.tick(self.source_path, snapshot))
        with ws.connection(ws.STATE) as db:
            jobs = ws.library(db, tenant, self.source, "employee")["jobs"]
        self.assertEqual(jobs[1]["status"], "unavailable")
        content, _ = ws.download(
            self.source, tenant, jobs[0]["token"], owner="employee"
        )
        self.assertNotIn(b"Orders over time", content)
        self.assertIn(b"Points balance over time", content)

    def test_previous_period_exports(self):
        def export(tab, filters, options=None, owner="admin", fmt="report"):
            view = dict(
                tab=tab,
                filters={**filters, "compare": "previous"},
                options=options or {},
            )
            job = dict(
                name=tab,
                tenant="meridian",
                owner=owner,
                format=fmt,
                view=ws.clean_view(self.source, "meridian", view, owner),
            )
            body, _ = ws.make_csv(self.source, snapshot, job)
            return list(csv.reader(io.StringIO(body.decode("utf-8-sig"))))

        for tab in ("overview", "activity"):
            rows = export(tab, {"period": "2026-10"})
            self.assertIn(["Previous from", "2026-09-01"], rows)
            self.assertIn(["Previous through", "2026-09-30"], rows)
            self.assertIn(["Approved recognitions", "19", "12", "+7"], rows)

        # The chart opened from the dashboard and its CSV share the same aligned rows.
        def chart_rows(rows, title):
            start = rows.index([title]) + 1
            end = rows.index([], start) if [] in rows[start:] else len(rows)
            return rows[start:end]

        october = {"period": "2026-10"}
        dashboard = export("overview", october)
        for tab, title in (
            ("activity", "Recognition over time"),
            ("orders", "Orders over time"),
            ("wallets", "Points balance over time"),
            ("participation", "Participation by program"),
            ("awards", "Milestone awards by status"),
        ):
            with self.subTest(chart=title):
                filters = {**october, "eligibilityPeriod": "2026-10"}
                dates = {"start": "2026-10-01", "end": "2026-10-31"}
                report = export(tab, filters, dates)
                self.assertEqual(
                    chart_rows(dashboard, title), chart_rows(report, title)
                )
        _, *activity = chart_rows(dashboard, "Recognition over time")
        self.assertEqual(len(activity), 31)
        self.assertEqual(activity[-1][1:], ["2026-10-31", "0", "", ""])
        self.assertEqual(
            (
                sum(int(r[2]) for r in activity),
                sum(int(r[4]) for r in activity if r[4]),
            ),
            (19, 12),
        )
        _, *status = chart_rows(dashboard, "Milestone awards by status")
        self.assertIn(["Outstanding", "3", "1"], status)
        _, *wallet = chart_rows(dashboard, "Points balance over time")
        self.assertEqual(wallet[0][1:], ["2026-10-01", "42375", "2026-09-01", "41925"])

        november = export("overview", {"period": "2026-11"})
        self.assertIn(["Previous through", "2026-10-10"], november)
        self.assertEqual(
            chart_rows(november, "Orders over time")[-1][1::2],
            ["2026-11-10", "2026-10-10"],
        )
        september = export("activity", {"period": "2026-09"})
        self.assertEqual(
            chart_rows(september, "Recognition over time")[-1][:4],
            ["31", "", "", "2026-08-31"],
        )
        custom = {"period": "custom", "start": "2026-10-03", "end": "2026-10-23"}
        rows = export(
            "orders", custom, {**custom, "status": "delivered"}, owner="employee"
        )
        self.assertIn(["Previous from", "2026-09-12"], rows)
        self.assertIn(["Previous through", "2026-10-02"], rows)
        self.assertIn(["Orders placed", "1", "0", "+1"], rows)
        self.assertFalse(any("Order value" in r for r in rows))

        rows = export("overview", {"period": "all"})
        self.assertTrue(any(r and r[0] == "Comparison availability" for r in rows))
        counts = next(r for r in rows if r and r[0] == "Approved recognitions")
        self.assertEqual(counts[2:], ["—", "—"])
        self.assertTrue(
            all(row[4] == "" for row in chart_rows(rows, "Recognition over time")[1:])
        )
        self.assertTrue(
            all(
                row[-1] == ""
                for row in chart_rows(rows, "Participation by program")[1:]
            )
        )

        raw = export("activity", {"period": "2026-10"}, fmt="recipients")
        self.assertEqual(
            raw[0][:4], ["Period", "Period from", "Period through", "Recognition ID"]
        )
        for name, start, end, count in (
            ("Current", "2026-10-01", "2026-10-31", 19),
            ("Previous", "2026-09-01", "2026-09-30", 12),
        ):
            records = [r for r in raw[1:] if r[0] == name]
            self.assertEqual(len({r[3] for r in records}), count)
            self.assertTrue(all(r[1:3] == [start, end] for r in records))

    def test_custom_periods_and_overlapping_recipients(self):
        filters = dict(
            period="custom",
            start="2026-10-03",
            end="2026-10-06",
            compare="custom",
            comparisonStart="2026-10-05",
            comparisonEnd="2026-10-07",
        )
        view = dict(tab="activity", filters=filters, options={}, tag=None)
        tenant = "meridian"

        def render(view, output):
            job = dict(
                view=ws.clean_view(self.source, tenant, view, "admin"),
                format=output,
                tenant=tenant,
                owner="admin",
                name="Selected dates",
            )
            body, _ = ws.make_csv(self.source, snapshot, job)
            return list(csv.reader(io.StringIO(body.decode("utf-8-sig"))))

        for tab in ("overview", "activity"):
            rows = render({**view, "tab": tab}, "report")
            self.assertIn(["Comparison from", "2026-10-05"], rows)
            self.assertIn(["Comparison through", "2026-10-07"], rows)
            self.assertIn(["Approved recognitions", "8", "5", "+3"], rows)
            self.assertIn(["1", "2026-10-03", "2", "2026-10-05", "3"], rows)
            self.assertIn(["4", "2026-10-06", "1", "", ""], rows)
        header, *contents = render(view, "recipients")
        groups = {"Current": set(), "Comparison": set()}
        for r in contents:
            row = dict(zip(header, r))
            mode = row["Period"]
            first, last = (
                (filters["start"], filters["end"])
                if mode == "Current"
                else (filters["comparisonStart"], filters["comparisonEnd"])
            )
            self.assertEqual((row["Period from"], row["Period through"]), (first, last))
            self.assertLessEqual(first, row["Approved (UTC)"][:10])
            self.assertLessEqual(row["Approved (UTC)"][:10], last)
            groups[mode].add(row["Recognition ID"])
        self.assertEqual(
            (
                len(groups["Current"]),
                len(groups["Comparison"]),
                len(groups["Current"] & groups["Comparison"]),
            ),
            (8, 5, 4),
        )

        for start, end in [
            ("", ""),
            ("2026-10-07", "2026-10-06"),
            ("2026-02-30", "2026-10-07"),
            ("2025-12-31", "2026-01-01"),
            ("2026-10-01", "2026-11-11"),
        ]:
            with self.subTest(start=start, end=end), self.assertRaises(ws.Problem):
                ws.clean_view(
                    self.source,
                    tenant,
                    {
                        **view,
                        "filters": {
                            **filters,
                            "comparisonStart": start,
                            "comparisonEnd": end,
                        },
                    },
                    "admin",
                )

    def test_rolling_schedule_and_historical_attributes(self):
        tenant, owner = "meridian", "manager"
        filters = {
            "period": "last7",
            "compare": "previous",
            "attribute:research_group": "Discovery",
        }
        view = dict(tab="overview", filters=filters, options={}, tag=None)

        def stamp(day):
            return int(datetime(2026, 10, day, 12, tzinfo=timezone.utc).timestamp())

        with patch.object(ws.time, "time", return_value=stamp(15)):
            result = ws.mutate(
                self.source,
                tenant,
                dict(
                    action="schedule",
                    name="Research activity",
                    view=view,
                    cadence="daily",
                    weekday=0,
                    clock="12:00",
                ),
                owner,
            )
            self.assertEqual(result["items"][0]["view"], view)
        for day in (16, 17):
            with patch.object(ws.time, "time", return_value=stamp(day)):
                self.assertTrue(ws.tick(self.source_path, snapshot))
                with ws.connection(ws.STATE) as state:
                    job = ws.library(state, tenant, self.source, owner)["jobs"][0]
                body, _ = ws.download(self.source, tenant, job["token"], owner=owner)
                rows = list(csv.reader(io.StringIO(body.decode("utf-8-sig"))))
                first, end = f"2026-10-{day - 6:02}", f"2026-10-{day}"
                self.assertIn(["Window from (UTC)", first], rows)
                self.assertIn(["Window through (UTC)", end], rows)
                self.assertIn(["Previous through", f"2026-10-{day - 7:02}"], rows)
                self.assertIn(["Research group", "Discovery"], rows)

                def count(start, through):
                    return self.source.execute(
                        """SELECT COUNT(*) FROM v_official_recognition r
                      JOIN employee_history h ON h.tenant_id=r.tenant_id AND h.employee_id=r.sender_id
                      AND substr(r.activity_at,1,10)>=h.valid_from AND (h.valid_to IS NULL OR substr(r.activity_at,1,10)<h.valid_to)
                      WHERE r.tenant_id=? AND substr(r.activity_at,1,10) BETWEEN ? AND ? AND
                      h.org_id IN ('north','engineering','operations') AND json_extract(h.attributes_json,'$.research_group')='Discovery'""",
                        (tenant, start, through),
                    ).fetchone()[0]

                row = next(r for r in rows if r and r[0] == "Approved recognitions")
                self.assertEqual(
                    row[1:3],
                    [
                        str(count(first, end)),
                        str(count(f"2026-10-{day - 13:02}", f"2026-10-{day - 7:02}")),
                    ],
                )
        data = snapshot(self.source, tenant, owner, "activity")
        mover = [h for h in data["history"] if h["employee_id"] == "e18"]
        self.assertEqual(
            [(h["attributes"]["research_group"], h["valid_to"]) for h in mover],
            [("Discovery", "2026-10-16")],
        )
        self.source.execute(
            "DELETE FROM field_grants WHERE tenant_id=? AND user_id=? AND field_name='attribute:research_group'",
            (tenant, owner),
        )
        self.source.commit()
        self.assertNotIn(
            "research_group",
            snapshot(self.source, tenant, owner, "activity")["attribute_keys"],
        )
        with (
            patch.object(ws.time, "time", return_value=stamp(17)),
            self.assertRaises(ws.Problem),
        ):
            ws.download(self.source, tenant, job["token"], owner=owner)
        with self.assertRaises(ws.Problem):
            ws.clean_view(self.source, tenant, view, owner)

    def test_rolling_catalog_exports_keep_custom_comparison(self):
        now = int(datetime(2026, 11, 21, 12, tzinfo=timezone.utc).timestamp())
        filters = dict(
            period="last30",
            compare="custom",
            comparisonStart="2026-08-01",
            comparisonEnd="2026-08-15",
        )
        for mode, first in [
            ("last7", "2026-11-15"),
            ("last30", "2026-10-23"),
            ("last90", "2026-08-24"),
        ]:
            for tab in ("overview", "orders", "awards"):
                f = {
                    **filters,
                    "period": mode,
                    "eligibilityPeriod": mode,
                    "attribute:clinical_service": "Outpatient",
                }
                view = dict(
                    tab=tab,
                    filters=f,
                    options={"dateMode": mode} if tab == "orders" else {},
                )
                job = dict(
                    view=ws.clean_view(self.source, "harbor", view, "employee"),
                    name=tab,
                    owner="employee",
                    tenant="harbor",
                    created=now,
                    format="report",
                )
                content, _ = ws.make_csv(self.source, snapshot, job)
                rows = list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))
                self.assertIn(["Current from", first], rows)
                self.assertIn(["Current through", "2026-11-21"], rows)
                self.assertIn(["Comparison from", "2026-08-01"], rows)
                self.assertIn(["Clinical service", "Outpatient"], rows)
                self.assertFalse(any(r and r[0] == "Order value" for r in rows))

    def test_harbor_budget_and_grouped_series_match_drill_exports(self):
        def export(tab, filters, options=None, owner="admin"):
            view = ws.clean_view(self.source, "harbor", dict(
                tab=tab, filters=filters, options=options or {},
            ), owner)
            content, _ = ws.make_csv(self.source, snapshot, dict(
                tenant="harbor", owner=owner, name=tab, format="report", view=view,
            ))
            return list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))

        def table(rows, title):
            start = rows.index([title]) + 1
            stop = rows.index([], start) if [] in rows[start:] else len(rows)
            return rows[start:stop]

        f = dict(period="2026-10", compare="custom", comparisonStart="2026-09-01",
                 comparisonEnd="2026-09-21")
        overview = export("overview", {**f, "breakdown": "clinical_service"})
        self.assertIn(["Remaining budget", "95,175", "86,125", "+9,050"], overview)
        banks = table(overview, "Funding budgets")
        self.assertEqual(banks[1][1:5], ["18,725", "19,100", "150", "100"])
        self.assertEqual(banks[2][1:5], ["56,450", "47,025", "575", "275"])
        self.assertEqual(banks[3][1:], ["20,000", "20,000", "0", "0", "0%", "0%"])
        employee_filter = {"attribute:clinical_service": "Outpatient"}
        for tab, title in [
            ("activity", "Recognition over time"), ("participation", "Participation by program"),
            ("wallets", "Points balance over time"), ("orders", "Orders over time"),
            ("awards", "Milestone awards by status"), ("funding", "Award spending over time"),
        ]:
            with self.subTest(tab=tab):
                grouped = table(overview, title + " · Clinical service")
                report = export(tab, {**f, **employee_filter, "eligibilityPeriod": "2026-10"},
                                {"start": "2026-10-01", "end": "2026-10-31"})
                drill = table(report, title)
                self.assertEqual(grouped[0], ["Clinical service", *drill[0]])
                self.assertEqual([r[1:] for r in grouped[1:] if r[0] == "Outpatient"], drill[1:])
        filtered = table(export("overview", {**f, **employee_filter}), "Funding budgets")
        self.assertEqual([r[1:3] for r in banks[1:]], [r[1:3] for r in filtered[1:]])
        self.assertNotEqual([r[3] for r in banks[1:]], [r[3] for r in filtered[1:]])
        self.source.execute("""UPDATE employee_history SET attributes_json =
            json_remove(attributes_json, '$.clinical_service') WHERE tenant_id='harbor' AND employee_id='e02'""")
        grouped = table(export("overview", {"breakdown": "clinical_service"}),
                        "Award spending over time · Clinical service")
        self.assertEqual(len(grouped[0]), 4)
        drill = table(export("funding", {"unassigned:clinical_service": "1"},
                             {"start": "2026-10-01", "end": "2026-10-31"}), "Award spending over time")
        self.assertEqual([r[1:] for r in grouped if r[0] == "Unassigned"], drill[1:])
        with self.assertRaises(ws.Problem):
            export("overview", {"breakdown": "research_group"})

    def test_daily_bank_balances_match_ledger_and_funding_drill(self):
        def series(tab, filters, options=None):
            view = ws.clean_view(self.source, "harbor", dict(
                tab=tab, filters=filters, options=options or {},
            ), "admin")
            body, _ = ws.make_csv(self.source, snapshot, dict(
                tenant="harbor", owner="admin", view=view, name=tab, format="report",
                created=datetime(2026, 11, 12, tzinfo=timezone.utc).timestamp(),
            ))
            rows = list(csv.reader(io.StringIO(body.decode("utf-8-sig"))))
            start = rows.index(["Budget balance over time"]) + 1
            return rows[start:rows.index([], start)] if [] in rows[start:] else rows[start:]

        # The later, shorter comparison includes a top-up and corrections.
        filters = dict(period="2026-09", compare="custom",
                       comparisonStart="2026-10-01", comparisonEnd="2026-10-22",
                       **{"attribute:clinical_service": "Outpatient"})
        heads, *overview = series("overview", {**filters, "breakdown": "clinical_service"})
        self.assertEqual(len(overview), 3 * 30)
        for bank in ("shared", "north-fund", "reserve"):
            drill = series("funding", filters, dict(start="2026-09-01", end="2026-09-30", bank=bank))
            bank_rows = [row for row in overview if row[1] == bank]
            self.assertEqual(drill, [heads, *bank_rows])
            for _, _, day, current_date, current, previous_date, previous in bank_rows:
                self.assertEqual(current_date, f"2026-09-{int(day):02}")
                self.assertEqual(previous_date, f"2026-10-{int(day):02}" if int(day) <= 22 else "")
                for date, closing in ((current_date, current), (previous_date, previous)):
                    if date:
                        expected = self.source.execute("""SELECT COALESCE(SUM(points_delta),0)
                            FROM bank_ledger WHERE tenant_id='harbor' AND bank_id=?
                            AND substr(occurred_at,1,10)<=?""", (bank, date)).fetchone()[0]
                        self.assertEqual(int(closing), expected)
                    else:
                        self.assertEqual(closing, "")

        single = series("overview", {"period": "2026-10"})
        self.assertEqual(len(single[0]), 5)
        self.assertIn(["Shared Recognition Fund", "shared", "31", "2026-10-31", "56450"], single)
        rolling = series("funding", dict(period="last7", compare="previous"),
                         dict(dateMode="last7", bank="reserve"))
        self.assertEqual(rolling[-1][3:], ["2026-11-12", "", "2026-11-05", "20000"])
        unavailable = series("funding", dict(period="all", compare="previous"),
                             dict(start="2026-01-01", end="2026-11-10", bank="reserve"))
        self.assertTrue(all(row[-1] == "" for row in unavailable[1:]))

    def test_overview_downloads_recheck_budget_grant(self):
        self.commit_action("harbor", "export", tab="overview", format="report")
        self.assertTrue(ws.tick(self.source_path, snapshot))
        old_content = b"Recognition over time"
        with ws.connection(ws.STATE) as db:
            job = ws.library(db, "harbor", self.source)["jobs"][0]
            token = job["token"]
            content, _ = ws.download(self.source, "harbor", token)
            self.assertIn(b"Funding budgets", content)
            # Previous overview files used a digest of the five original sources.
            policy = Permissions(self.source, "harbor", "admin")
            sources = {k: policy.require(k) for k in policy.overview_tabs if k not in ("funding", "logins")}
            old_digest = "v2:" + hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest()
        self.source.execute("DELETE FROM report_grants WHERE tenant_id='harbor' AND user_id='admin' AND report_id='B1'")
        with self.assertRaises(ws.Problem):
            ws.download(self.source, "harbor", token)
        with ws.connection(ws.STATE) as db:
            db.execute("UPDATE jobs SET permissions=?, content=? WHERE token=?", (old_digest, old_content, token))
        self.assertEqual(ws.download(self.source, "harbor", token)[0], old_content)

    def test_hierarchy_grants_paths_and_transfers(self):
        for (tenant,) in self.source.execute("SELECT tenant_id FROM tenants"):
            for role, root in (("admin", "e17"), ("manager", "e04"), ("employee", "e09")):
                reports = snapshot(self.source, tenant, role, "overview")["reports"]
                for report in reports.values():
                    paths = {h["hierarchy"] for h in report["history"]}
                    self.assertTrue(all(p.split("/")[0] == root for p in paths))
                    self.assertTrue(all("manager_id" not in h for h in report["history"]))
                    if role == "employee":
                        self.assertEqual(paths, {"e09"})
                    if role == "manager":
                        self.assertIn("e04/e10/e18", paths)
                        self.assertFalse(any("e21" in p for p in paths))
            for role in ("manager", "employee"):
                with self.assertRaises(ws.Problem):
                    ws.clean_view(self.source, tenant, dict(tab="overview",
                        filters={"hierarchy": "e17/e21"}, options={}), role)

        # A supervisor moves. Descendants' unchanged assignments must split too.
        self.source.execute("""UPDATE employee_history SET valid_to='2026-07-01'
            WHERE tenant_id='harbor' AND employee_id='e10'""")
        self.source.execute("""INSERT INTO employee_history
            (tenant_id,history_id,employee_id,org_id,valid_from,valid_to,attributes_json,manager_id)
            SELECT tenant_id,'e10-new',employee_id,org_id,valid_to,NULL,attributes_json,'e17'
            FROM employee_history WHERE tenant_id='harbor' AND employee_id='e10'""")
        history = snapshot(self.source, "harbor", "admin", "activity")["history"]
        self.assertEqual([(h["hierarchy"], h["valid_from"], h["valid_to"]) for h in history
                          if h["employee_id"] == "e09"], [
            ("e17/e04/e10/e09", "2020-01-01", "2026-07-01"),
            ("e17/e10/e09", "2026-07-01", None),
        ])

    def test_team_drill_comparison_and_recipient_export(self):
        dates = dict(period="custom", start="2026-10-16", end="2026-10-31", compare="custom",
                     comparisonStart="2026-10-01", comparisonEnd="2026-10-15")
        def export(tab, path, mode="team", fmt="report", **filters):
            view = ws.clean_view(self.source, "harbor", dict(tab=tab, options={},
                filters={**dates, "hierarchy":path, "hierarchyMode":mode, **filters}), "admin")
            body, _ = ws.make_csv(self.source, snapshot, dict(tenant="harbor", owner="admin",
                view=view, name=tab, format=fmt))
            return list(csv.reader(io.StringIO(body.decode("utf-8-sig"))))
        old = "e17/e04/e10/e18"
        new = "e17/e21/e18"
        for path, counts, recognition, label in (
            (old, ["0", "1", "-1"], "r-before-transfer", "Comparison"),
            (new, ["1", "0", "+1"], "r-after-transfer", "Current"),
        ):
            for tab in ("overview", "activity"):
                self.assertIn(["Approved recognitions", *counts], export(tab, path))
            headers, *recipients = export("activity", path, fmt="recipients")
            records = [dict(zip(headers, row)) for row in recipients]
            self.assertEqual({r["Recognition ID"] for r in records}, {recognition})
            self.assertEqual({r["Period"] for r in records}, {label})
            self.assertTrue(all("Finley Sample Harbor" in r["Reporting hierarchy"] for r in records))
        self.assertIn(["Approved recognitions", "0", "0", "0"], export("activity", new, org="north"))
        team = export("overview", "e17/e04/e01")
        own = export("activity", "e17/e04/e01", "individual")
        self.assertNotEqual(next(r[1:3] for r in team if r and r[0]=="Approved recognitions"),
                            next(r[1:3] for r in own if r and r[0]=="Approved recognitions"))

    def test_organization_breakdown_rollups_and_drill_parity(self):
        def table(tab, filters, *, owner="admin", options=None):
            view = ws.clean_view(self.source, "harbor", dict(
                tab=tab, filters=filters, options=options or {},
            ), owner)
            content, _ = ws.make_csv(self.source, snapshot, dict(
                tenant="harbor", owner=owner, name=tab, format="report", view=view,
            ))
            rows = list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))
            title = "Organization breakdown" if tab == "overview" else "Period comparison"
            start = rows.index([title]) + 1
            end = rows.index([], start) if [] in rows[start:] else len(rows)
            return rows[start:end]

        october = {"period": "2026-10"}
        for org, expected in (("", {"north": "14", "south": "1"}),
                              ("north", {"operations": "13", "engineering": "1"}),
                              ("engineering", {"engineering": "1"})):
            head, *rows = table("overview", {**october, "org": org})
            self.assertEqual(head[-1], "Current")
            self.assertEqual({r[0]: r[3] for r in rows if r[2] == "Approved recognitions"}, expected)
            self.assertNotIn("Remaining budget", {r[2] for r in rows})
        filters = dict(period="custom", start="2026-10-16", end="2026-10-31", compare="custom",
                       comparisonStart="2026-10-01", comparisonEnd="2026-10-15", org="north",
                       hierarchy="e17/e04", **{"attribute:employment_type": "full_time"})
        head, *rows = table("overview", filters)
        self.assertEqual(head[-3:], ["Current", "Comparison", "Change"])
        engineering = {r[2]: r[3:] for r in rows if r[0] == "engineering"}
        self.assertEqual(engineering["Approved recognitions"], ["0", "1", "-1"])
        for tab, metric in (("activity", "Approved recognitions"), ("participation", "Receiving participation"),
                            ("orders", "Order value"), ("wallets", "Points balance"),
                            ("awards", "Milestone awards"), ("funding", "Award spending")):
            with self.subTest(tab=tab):
                detail = table(tab, {**filters, "org": "engineering", "eligibilityPeriod": "custom"},
                               options=dict(start=filters["start"], end=filters["end"], org="engineering"))
                self.assertEqual(next(r[1:] for r in detail if r[0] == metric),
                                 engineering[metric if tab != "funding" else "Award spending (points)"])
        for role, allowed in (("manager", {"north"}), ("employee", {"engineering"})):
            _, *rows = table("overview", {**october, "compare": "previous"}, owner=role)
            self.assertEqual({r[0] for r in rows}, allowed)
            self.assertNotIn("Order value", {r[2] for r in rows})
        _, *unavailable = table("overview", {"period": "all", "compare": "previous"})
        self.assertTrue(all(r[-2:] == ["—", "—"] for r in unavailable))

    def test_named_team_pages_and_historical_individual_records(self):
        dates = dict(period="custom", start="2026-10-16", end="2026-10-31", compare="custom",
                     comparisonStart="2026-10-01", comparisonEnd="2026-10-15")
        def view(path, mode="team"):
            return dict(tab="teams", filters=dates, options=dict(managerPath=path, pageMode=mode))
        def export(path, mode="team", owner="admin"):
            v = ws.clean_view(self.source, "harbor", view(path, mode), owner)
            body, _ = ws.make_csv(self.source, snapshot, dict(tenant="harbor", owner=owner,
                name="Team report", format="report", view=v))
            return list(csv.reader(io.StringIO(body.decode("utf-8-sig"))))

        manager = export("e17/e04/e10")
        self.assertIn(["Jules Demo Harbor’s team"], manager)
        self.assertIn(["Direct reports"], manager)
        self.assertIn(["Page scope", "Team"], manager)
        self.assertIn(["Comparison through", "2026-10-15"], manager)
        for path, event, other, period in (
            ("e17/e04/e10/e18", "r-before-transfer", "r-after-transfer", "Comparison"),
            ("e17/e21/e18", "r-after-transfer", "r-before-transfer", "Current"),
        ):
            rows = export(path, "individual")
            self.assertIn(["Page scope", "Individual"], rows)
            self.assertIn(["Individual records"], rows)
            self.assertIn(["Finley Sample Harbor"], rows)
            self.assertTrue(any(r and r[0] == period and r[-1] == event for r in rows))
            self.assertFalse(any(other in r for r in rows))
            self.assertNotIn(["Direct reports"], rows)
        personal = export("e09", "individual", "employee")
        self.assertIn(["Indigo Demo Harbor"], personal)
        self.assertNotIn(["Direct reports"], personal)
        self.assertFalse(any("Order value" in r for r in personal))
        for owner in ("manager", "employee"):
            with self.assertRaises(ws.Problem):
                ws.clean_view(self.source, "harbor", view("e17/e21"), owner)

        lib = ws.mutate(self.source, "harbor", dict(action="save", name="Engineering team",
                        view=view("e04/e10")), "manager")
        self.assertEqual(lib["items"][0]["view"]["options"]["managerPath"], "e04/e10")
        self.assertNotIn("hierarchy", lib["items"][0]["view"]["filters"])
        self.source.execute("UPDATE report_grants SET org_id='south' WHERE tenant_id='harbor' AND user_id='manager'")
        with ws.connection(ws.STATE) as db:
            self.assertFalse(ws.library(db, "harbor", self.source, "manager")["items"][0]["available"])

    def test_participation_team_rows_reconcile_with_named_pages(self):
        dates = dict(period="custom", start="2026-10-16", end="2026-10-31",
                     compare="custom", comparisonStart="2026-10-01", comparisonEnd="2026-10-15")

        def view(path, **filters):
            return dict(tab="participation", options=dict(managerPath=path, pageMode="team"),
                        filters={**dates, **filters})

        def export(settings, owner="admin"):
            checked = ws.clean_view(self.source, "harbor", settings, owner)
            content, _ = ws.make_csv(self.source, snapshot, dict(
                tenant="harbor", owner=owner, view=checked, format="report", name="Participation"))
            return list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))

        parent = "e17/e04"
        child = parent + "/e10"
        for filters in ({}, {"org": "north", "program": "peer", "attribute:clinical_service": "Outpatient"}):
            parent_rows = export(view(parent, **filters))
            jules = next(row for row in parent_rows if row and row[0] == "Jules Demo Harbor")
            child_rows = export(view(child, **filters))
            for i, label in [(1, "Sending participation"), (6, "Receiving participation")]:
                self.assertIn([label, jules[i], jules[i + 2], jules[i + 4]], child_rows)
                self.assertIn([label, jules[i], jules[i + 1]], child_rows)
            if not filters:
                self.assertEqual(jules[6:], ["12.5%", "1 of 8 eligible recipients", "88.9%",
                                            "8 of 9 eligible recipients", "-76.4 pp"])
        for path, current, previous in [(child + "/e18", "—", "100%"), ("e17/e21/e18", "100%", "—")]:
            rows = export(view(path))
            self.assertIn(["Sending participation", current, previous, "—"], rows)
            self.assertIn(["Page scope", "Individual"], rows)
            self.assertNotIn(["Direct reports"], rows)

        manager_view = view("e04/e10")
        saved = ws.mutate(self.source, "harbor", dict(action="save", name="Participation",
                          view=manager_view), "manager")["items"][0]
        self.assertEqual(saved["view"]["options"], manager_view["options"])
        self.assertIn(["Participation · Jules Demo Harbor’s team"], export(saved["view"], "manager"))
        with self.assertRaises(ws.Problem):
            ws.clean_view(self.source, "harbor", view("e17/e21"), "manager")
        with self.assertRaises(ws.Problem):
            ws.clean_view(self.source, "harbor", manager_view, "employee")

    def test_recognition_activity_team_comparison_and_recipient_drill(self):
        dates = dict(period="custom", start="2026-10-16", end="2026-10-31", compare="custom",
                     comparisonStart="2026-10-01", comparisonEnd="2026-10-15")
        def export(path, *, filters=None, tag=None, options=None, fmt="report", owner="admin"):
            view = dict(tab="activity", filters={**dates, **(filters or {})},
                        options={"managerPath": path, "pageMode": "team", **(options or {})}, tag=tag)
            checked = ws.clean_view(self.source, "harbor", view, owner)
            content, _ = ws.make_csv(self.source, snapshot, dict(
                tenant="harbor", owner=owner, view=checked, format=fmt, name="Recognition activity"))
            return list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))

        drew = "e17/e04"
        alex = drew + "/e01"
        jules = drew + "/e10"
        team = export(drew)
        for path, person, counts in [(alex, "Alex Demo Harbor", ["2", "9", "-7"]),
                                     (jules, "Jules Demo Harbor", ["0", "1", "-1"])]:
            self.assertIn([person, *counts], team)
            self.assertIn(["Approved recognitions", *counts], export(path))

        # A tagged, multi-recipient event still contributes just one to its sender's team.
        selection = dict(filters={"org": "north", "program": "peer", "attribute:clinical_service": "Acute care"},
                         tag={"kind": "value", "label": "Ownership"})
        self.assertIn(["Alex Demo Harbor", "0", "1", "-1"], export(drew, **selection))
        self.assertIn(["Approved recognitions", "0", "1", "-1"], export(alex, **selection))
        heads, *rows = export(alex, **selection, fmt="recipients")
        self.assertGreater(len(rows), 1)
        self.assertTrue(all(len(r) == len(heads) for r in rows))
        self.assertEqual({r[heads.index("Recognition ID")] for r in rows}, {"r-multi"})
        self.assertEqual({r[heads.index("Period")] for r in rows}, {"Comparison"})
        self.assertTrue(all("Alex Demo Harbor (team)" in r[heads.index("Reporting hierarchy")] for r in rows))

        for path, period, event in [(jules + "/e18", "Comparison", "r-before-transfer"),
                                    ("e17/e21/e18", "Current", "r-after-transfer")]:
            heads, *rows = export(path, options={"pageMode": "individual"}, fmt="recipients")
            self.assertEqual({(r[heads.index("Period")], r[heads.index("Recognition ID")]) for r in rows},
                             {(period, event)})
        self.assertIn(["Jules Demo Harbor", "0", "1", "-1"], export("e04", owner="manager"))
        with self.assertRaises(ws.Problem):
            export("e17/e21", owner="manager")
        with self.assertRaises(ws.Problem):
            export(drew, owner="employee")

    def test_categories_team_label_comparison_and_tagged_activity(self):
        dates = dict(period="custom", start="2026-10-16", end="2026-10-31",
                     compare="custom", comparisonStart="2026-10-01", comparisonEnd="2026-10-15")

        def export(path, *, filters=None, tab="categories", owner="admin", tag=None):
            view = dict(tab=tab, filters={**dates, **(filters or {})},
                        options=dict(managerPath=path, pageMode="team", teamLabelKind="value"), tag=tag)
            checked = ws.clean_view(self.source, "harbor", view, owner)
            content, _ = ws.make_csv(self.source, snapshot, dict(
                tenant="harbor", owner=owner, view=checked, format="report", name="Labels"))
            return list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))

        drew = "e17/e04"
        alex = drew + "/e01"
        parent = export(drew)
        self.assertIn(["Alex Demo Harbor", "total", "Approved recognitions", "2", "9", "-7"], parent)
        self.assertIn(["Alex Demo Harbor", "category", "Customer impact", "2", "5", "-3"], parent)
        self.assertIn(["Jules Demo Harbor", "category", "Customer impact", "0", "1", "-1"], parent)
        for filters, counts in [
            ({}, ["0", "3", "-3"]),
            ({"org": "north", "program": "peer", "attribute:clinical_service": "Acute care"}, ["0", "1", "-1"]),
        ]:
            self.assertIn(["Alex Demo Harbor", "value", "Ownership", *counts], export(drew, filters=filters))
            self.assertIn(["Ownership", *counts], export(alex, filters=filters))
            detail = export(alex, tab="activity", filters=filters, tag=dict(kind="value", label="Ownership"))
            self.assertIn(["Approved recognitions", *counts], detail)
        for path, counts in [(drew + "/e10/e18", ["0", "1", "-1"]), ("e17/e21/e18", ["1", "0", "+1"])]:
            rows = export(path)
            self.assertIn(["Page scope", "Individual"], rows)
            self.assertIn(["Collaboration", *counts], rows)
            self.assertNotIn(["Direct reports"], rows)
        rows = export(alex, filters={"period": "all", "compare": "previous"})
        self.assertTrue(any(r[:3] == ["Blair Demo Harbor", "value", "Ownership"] and r[-2:] == ["—", "—"] for r in rows))
        # R2 is independent of the grant for Recognition activity.
        self.source.execute("DELETE FROM report_grants WHERE tenant_id='harbor' AND user_id='manager' AND report_id='R1'")
        self.assertIn(["Alex Demo Harbor", "category", "Customer impact", "2", "5", "-3"], export("e04", owner="manager"))
        with self.assertRaises(ws.Problem):
            export("e04", owner="manager", tab="activity")
        with self.assertRaises(ws.Problem):
            export("e17/e21", owner="manager")
        with self.assertRaises(ws.Problem):
            export(drew, owner="employee")

    def test_program_performance_team_counts_rates_and_legacy_views(self):
        dates = dict(period="custom", start="2026-10-16", end="2026-10-31", compare="custom",
                     comparisonStart="2026-10-01", comparisonEnd="2026-10-15", program="peer")
        def view(path, mode="team", **filters):
            return dict(tab="performance", filters={**dates, **filters},
                        options=dict(managerPath=path, pageMode=mode))

        def export(settings):
            content, _ = ws.make_csv(self.source, snapshot, dict(tenant="harbor", owner="admin",
                view=json.dumps(settings), format="report", name="Program performance"))
            return list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))

        drew = "e17/e04"
        alex = drew + "/e01"
        jules = drew + "/e10"
        for selection in ({}, {"org": "north", "attribute:clinical_service": "Acute care"}):
            parent = export(view(drew, **selection))
            heads = parent[parent.index(["Direct reports"]) + 1]
            row = next(r for r in parent if r and r[0] == "Alex Demo Harbor")
            child = export(view(alex, **selection))
            for metric in ["Approved recognitions", "Sending participation", "Receiving reach",
                           "Events / active sender", "Points awarded"]:
                pos = heads.index(metric)
                self.assertIn([metric, *row[pos:pos + 3]], child)
            if not selection:
                self.assertIn(["Approved recognitions", "1", "4", "-3"], child)
                self.assertIn(["Sending participation", "14.3%", "28.6%", "-14.3 pp"], child)
                self.assertIn(["Points awarded", "50", "400", "-350"], child)
        child = export(view(jules))
        self.assertIn(["Approved recognitions", "0", "0", "0"], child)
        self.assertIn(["Receiving reach", "0%", "44.4%", "-44.4 pp"], child)
        for path, expected in [(jules + "/e18", ["0", "1", "-1"]), ("e17/e21/e18", ["1", "0", "+1"])]:
            rows = export(view(path, "individual", program="care"))
            self.assertIn(["Approved recognitions", *expected], rows)
            self.assertNotIn(["Direct reports"], rows)
        rows = export(view(alex, period="all", compare="previous"))
        self.assertTrue(any(r[:1] == ["Approved recognitions"] and r[-2:] == ["—", "—"] for r in rows))
        for owner in ("manager", "employee"):
            with self.assertRaises(ws.Problem):
                ws.clean_view(self.source, "harbor", view(alex), owner)

        # An old delivery may carry unrelated shared settings. Its catalog options were authoritative.
        legacy = dict(tab="performance", filters={"period": "all", "org": "south", "hierarchy": alex},
                      options={"program": "peer", "start": dates["start"], "end": dates["end"], "org": "north"})
        rows = export(legacy)
        self.assertIn(["Program", "Everyday Thanks"], rows)
        self.assertIn(["From", dates["start"]], rows)
        self.assertIn(["Approved recognitions", "1", "Distinct events by sender scope"], rows)
        legacy["options"] = {"dateMode": "last30", "program": "peer"}
        self.assertIn(["Rolling period", "Last 30 days"], export(legacy))
        legacy["options"] = {}
        rows = export(legacy)
        self.assertIn(["From", "2026-10-01"], rows)
        self.assertIn(["Program", "All programs"], rows)
        new_root = json.loads(ws.clean_view(self.source, "harbor",
            dict(tab="performance", filters=dates, options={}), "admin"))
        self.assertEqual(new_root["filters"], dates)
        self.assertEqual(new_root["options"]["managerPath"], "")

    def test_leaderboard_drill_and_independent_population_suppression(self):
        dates = dict(period="custom", start="2026-10-16", end="2026-10-31", compare="custom",
                     comparisonStart="2026-10-01", comparisonEnd="2026-10-15", program="peer")
        drew = "e17/e04"
        alex, jules = drew + "/e01", drew + "/e10"

        def view(path, direction, **filters):
            return dict(tab="leaders", filters={**dates, **filters},
                        options=dict(managerPath=path, pageMode="team", direction=direction))

        def export(settings):
            contents, _ = ws.make_csv(self.source, snapshot, dict(tenant="harbor", owner="admin",
                view=json.dumps(settings), format="report", name="Leaderboard"))
            return list(csv.reader(io.StringIO(contents.decode("utf-8-sig"))))

        def section(rows, title):
            first = rows.index([title]) + 2
            return rows[first:next((i for i in range(first, len(rows)) if not rows[i]), len(rows))]

        parent = section(export(view(drew, "send")), "Direct reports")
        alex_rows = [r for r in parent if r[2] == "Alex Demo Harbor"]
        self.assertEqual(alex_rows[0][3:], ["1", "7", "1", "0.14", "14.3%", "Suppressed"])
        self.assertEqual(alex_rows[1][3:], ["4", "7", "2", "0.57", "28.6%", "Suppressed"])
        self.assertEqual(alex_rows[2][3:], ["-3", "0", "-1", "-0.43", "-14.3 pp", "—"])
        self.assertEqual([r[2:] for r in section(export(view(alex, "send")), "Team summary")],
                         [r[3:] for r in alex_rows])
        receive = section(export(view(drew, "receive")), "Direct reports")
        self.assertEqual({r[2] for r in receive}, {"Jules Demo Harbor"})
        self.assertEqual([r[3:5] for r in receive], [["0", "8"], ["5", "9"], ["-5", "-1"]])
        self.assertEqual([r[2:] for r in section(export(view(jules, "receive")), "Team summary")],
                         [r[3:] for r in receive])

        # A direct link, an attribute selection, or a stored single-person view cannot bypass the minimum.
        for small in (view(alex, "receive"), view(alex + "/e02", "send"),
                      view(alex, "send", **{"attribute:clinical_service": "Outpatient"})):
            rows = export(small)
            self.assertEqual(section(rows, "Team summary"), [["Suppressed"]])
            self.assertNotIn(["Individual rankings"], rows)
            self.assertNotIn(["Direct reports"], rows)

        for owner in ("manager", "employee"):
            with self.assertRaises(ws.Problem):
                ws.clean_view(self.source, "harbor", view(drew, "receive"), owner)
        legacy = dict(tab="leaders", filters=dict(period="all", hierarchy=jules),
                      options=dict(start=dates["start"], end=dates["end"], program="peer", direction="receive"))
        restored = export(legacy)
        for pair in [["Program", "Everyday Thanks"], ["Rank by", "Received recognition"], ["From", dates["start"]]]:
            self.assertIn(pair, restored)

        signature = ws.access(self.source, "harbor", "leaders", "admin")
        self.source.execute("UPDATE dataset_metadata SET value='9' WHERE key='small_population_threshold'")
        self.assertNotEqual(ws.access(self.source, "harbor", "leaders", "admin"), signature)
        rows = section(export(view(drew, "receive")), "Direct reports")
        self.assertEqual([r[2] for r in rows], ["Jules Demo Harbor"] * 3)
        self.assertEqual(rows[0], ["Current", "Suppressed", "Jules Demo Harbor", *(["Suppressed"] * 6)])
        self.assertEqual(rows[1], ["Comparison", "1", "Jules Demo Harbor", "5", "9", "4", "0.56", "44.4%", "Suppressed"])
        self.assertEqual(rows[2][3:], ["—"] * 6)
        child = export(view(jules, "receive"))
        self.assertEqual([r[2:] for r in section(child, "Team summary")], [r[3:] for r in rows])
        for r in section(child, "Individual rankings"):
            if r[0] == "Current":
                self.assertEqual([r[1], *r[3:]], ["Suppressed"] * 3)

    def test_approval_status_team_counts_ledgers_and_legacy_views(self):
        dates = dict(period="custom", start="2026-11-01", end="2026-11-10", compare="custom",
                     comparisonStart="2026-10-01", comparisonEnd="2026-10-10", program="spot")
        drew = "e17/e04"
        alex = drew + "/e01"

        def view(path, *, status="", query="", mode="team", **filters):
            return dict(tab="investigation", filters={**dates, **filters}, options=dict(
                managerPath=path, pageMode=mode, status=status, query=query))

        def export(settings):
            contents, _ = ws.make_csv(self.source, snapshot, dict(tenant="harbor", owner="admin",
                view=json.dumps(settings), format="report", name="Approval history"))
            return list(csv.reader(io.StringIO(contents.decode("utf-8-sig"))))

        def section(rows, title):
            first = rows.index([title]) + 2
            return rows[first:next((i for i in range(first, len(rows)) if not rows[i]), len(rows))]

        parent = section(export(view(drew)), "Direct reports")
        counts = {r[1]: r[2:] for r in parent if r[0] == "Alex Demo Harbor"}
        self.assertEqual(counts["Total requests"], ["7", "2", "+5"])
        self.assertEqual(counts["Approved"], ["3", "2", "+1"])
        for status in ("Pending", "Canceled", "Submitted", "Rejected"):
            self.assertEqual(counts[status], ["1", "0", "+1"])
        self.assertIn(["Jules Demo Harbor", "Total requests", "0", "0", "0"], parent)
        child = export(view(alex))
        for status, now, before in section(child, "Requests by approval status"):
            self.assertEqual(counts[status][:2], [now, before])
        for window, title in enumerate(("Recognition requests", "Comparison period requests")):
            ledger = section(child, title)
            self.assertEqual(len({r[0] for r in ledger}), int(counts["Total requests"][window]))
            for status, values in counts.items():
                if status != "Total requests":
                    self.assertEqual(sum(r[5] == status.lower() for r in ledger), int(values[window]))
        selected = dict(status="pending", query="R-PEND", org="north", **{"attribute:clinical_service": "Acute care"})
        self.assertIn(["Alex Demo Harbor", "Pending", "1", "0", "+1"],
                      section(export(view(drew, **selected)), "Direct reports"))
        personal = export(view(alex, mode="individual", **selected))
        self.assertNotIn(["Direct reports"], personal)
        self.assertEqual([r[0] for r in section(personal, "Recognition requests")], ["r-pending"])
        self.assertEqual(section(personal, "Comparison period requests"), [])
        self.assertIn(["Search", "R-PEND"], personal)
        self.assertIn(["Clinical service", "Acute care"], personal)

        transfer = dict(program="care", start="2026-10-16", end="2026-10-31",
                        comparisonEnd="2026-10-15", query="transfer", mode="individual")
        for path, ids in [(drew + "/e10/e18", [[], ["r-before-transfer"]]),
                          ("e17/e21/e18", [["r-after-transfer"], []])]:
            rows = export(view(path, **transfer))
            self.assertEqual([[r[0] for r in section(rows, label)] for label in
                              ("Recognition requests", "Comparison period requests")], ids)
        boundary = export(view(alex, program="peer", query="r-boundary", start="2026-10-01",
                               end="2026-10-01", comparisonStart="2026-09-30", comparisonEnd="2026-09-30"))
        self.assertEqual(section(boundary, "Recognition requests"), [])
        self.assertEqual(section(boundary, "Comparison period requests")[0][0], "r-boundary")
        no_history = export(view(drew, period="all", compare="previous"))
        self.assertNotIn(["Previous period requests"], no_history)
        self.assertTrue(all(r[-2:] == ["—", "—"] for r in section(no_history, "Direct reports")))

        legacy = dict(tab="investigation", filters=dict(period="2026-10", hierarchy=alex, compare="previous"),
                      options=dict(program="spot", query="r-pending"))
        rows = export(legacy)
        self.assertIn(["From", "2026-01-01"], rows)
        self.assertIn(["Through", "2026-11-10"], rows)
        self.assertEqual(section(rows, "Recognition requests")[0][0], "r-pending")
        self.assertNotIn(["Previous period requests"], rows)
        for owner in ("manager", "employee"):
            with self.assertRaises(ws.Problem):
                ws.clean_view(self.source, "harbor", view(drew), owner)

    def test_login_counts_distinct_population_and_transfer_permissions(self):
        def view(path="", mode="team", **filters):
            return dict(tab="logins", filters={"period": "2026-10", "compare": "previous", **filters},
                        options=dict(managerPath=path, pageMode=mode))

        def export(owner, settings):
            content, _ = ws.make_csv(self.source, snapshot, dict(tenant="harbor", owner=owner,
                format="report", name="User logins", view=json.dumps(settings)))
            return list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))

        for (tenant,) in self.source.execute("SELECT tenant_id FROM tenants"):
            for owner in ("admin", "manager", "employee"):
                report = snapshot(self.source, tenant, owner, "logins")
                events = report["catalog"]["logins"]
                self.assertTrue(events)
                if owner == "employee":
                    self.assertEqual({r["employee_id"] for r in events}, {"e09"})
                    self.assertEqual(set(report["people"]), {"e09"})
                if owner == "manager":
                    self.assertTrue(all(r["occurred_at"] < "2026-10-16" for r in events if r["employee_id"] == "e18"))
                unrelated = snapshot(self.source, tenant, owner, "awards")
                self.assertNotIn("logins", unrelated["catalog"])
        admin = export("admin", view())
        for row in (["Successful logins", "244", "234", "+10"], ["Users logged in", "35", "34", "+1"],
                    ["Users without a login", "5", "5", "0"], ["Gray Demo Harbor", "0", "—", "0", "—"]):
            self.assertIn(row, admin)
        personal = export("employee", view())
        self.assertIn(["Indigo Demo Harbor", "7", "2026-10-28 08:00 UTC", "8", "2026-09-30 08:00 UTC"], personal)
        self.assertEqual(sum(r[:1] == ["Current"] for r in personal), 7)
        self.assertIn(["Successful logins", "105", "101", "+4"], export("manager", view()))
        for path, count in (("e17/e04/e10/e18", 4), ("e17/e21/e18", 4)):
            rows = export("admin", view(path, "individual"))
            self.assertEqual(sum(r[:1] == ["Current"] for r in rows), count)
        with self.assertRaises(ws.Problem):
            ws.clean_view(self.source, "harbor", view("e17/e21/e18", "individual"), "manager")
        self.source.execute("DELETE FROM report_grants WHERE tenant_id='harbor' AND user_id='employee' AND report_id='U1'")
        with self.assertRaises(ws.Problem):
            export("employee", view())

    def test_overview_login_trend_matches_report_and_rechecks_grant(self):
        def export(tab, owner, filters):
            settings = dict(tab=tab, filters=filters, options={})
            job = dict(tenant="harbor", owner=owner, name=tab, format="report",
                       view=ws.clean_view(self.source, "harbor", settings, owner))
            content, _ = ws.make_csv(self.source, snapshot, job)
            return list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))

        def section(rows, title):
            start = rows.index([title]) + 1
            return rows[start:next((i for i in range(start, len(rows)) if not rows[i]), len(rows))]

        october = dict(period="2026-10", compare="previous")
        custom = dict(period="custom", start="2026-10-15", end="2026-10-20",
                      compare="custom", comparisonStart="2026-10-01", comparisonEnd="2026-10-04",
                      org="engineering", **{"attribute:clinical_service": "Acute care"})
        for owner, expected in (("admin", ["244", "35", "5"]), ("manager", ["105", "15", "2"]),
                                ("employee", ["7", "1", "0"])):
            for filters in (october, custom):
                overview = export("overview", owner, filters)
                login = export("logins", owner, filters)
                metrics = section(login, "Period comparison")[1:]
                for metric in metrics:
                    self.assertIn(metric, section(overview, "Period comparison"))
                if filters == october:
                    self.assertEqual([m[1] for m in metrics], expected)
                self.assertEqual(section(overview, "Logins over time"), section(login, "Logins over time"))
        plain = section(export("overview", "admin", {"period": "2026-10"}), "Logins over time")
        self.assertEqual(sum(int(r[2]) for r in plain[1:]), 244)
        grouped = export("overview", "admin", {**october, "breakdown": "clinical_service"})
        series = section(grouped, "Logins over time · Clinical service")
        group_rows = [r[1:] for r in series[1:] if r[0] == "Outpatient"]
        drill = export("logins", "admin", {**october, "attribute:clinical_service": "Outpatient"})
        self.assertEqual(group_rows, section(drill, "Logins over time")[1:])

        self.commit_action("harbor", "export", tab="overview", format="report")
        self.assertTrue(ws.tick(self.source_path, snapshot))
        with ws.connection(ws.STATE) as db:
            token = ws.library(db, "harbor", self.source)["jobs"][0]["token"]
        legacy = ws.access(self.source, "harbor", "overview", "admin", 3)
        self.source.execute("DELETE FROM report_grants WHERE tenant_id='harbor' AND user_id='admin' AND report_id='U1'")
        self.assertNotIn("logins", snapshot(self.source, "harbor", "admin", "overview")["reports"])
        remaining = export("overview", "admin", october)
        self.assertNotIn(["Logins over time"], remaining)
        self.assertFalse(any(r and r[0] == "Users without a login" for r in remaining))
        with self.assertRaises(ws.Problem):
            ws.download(self.source, "harbor", token)
        self.assertEqual(ws.access(self.source, "harbor", "overview", "admin", 3), legacy)

    def test_overview_no_login_list_uses_current_population(self):
        def report(tab, role, filters, path=""):
            options = {}
            if tab == "logins":
                options = {"loginDetail": "withoutLogin", "managerPath": path, "pageMode": "team"}
            elif path:
                filters = {**filters, "hierarchy": path}
            view = ws.clean_view(self.source, "harbor", dict(tab=tab, options=options, filters=filters), role)
            job = dict(tenant="harbor", owner=role, name=tab, format="report", view=view)
            content, _ = ws.make_csv(self.source, snapshot, job)
            return list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))

        def compare(role, filters, path=""):
            overview = report("overview", role, filters, path)
            count = next(r[1] for r in overview if r and r[0] == "Users without a login")
            detail = report("logins", role, filters, path)
            self.assertIn(["Matching employees", count], detail)
            start = detail.index(["Users without a login"]) + 2
            employees = detail[start:next((i for i in range(start, len(detail)) if not detail[i]), len(detail))]
            self.assertEqual(len(employees), int(count))
            self.assertEqual(len({r[1] for r in employees}), len(employees))
            self.assertTrue(all(r[2] == "0" for r in employees))
            return {r[1]: r for r in employees}

        october = dict(period="2026-10", compare="previous")
        for role, expected in (("admin", {"e07", "e14", "e21", "e28", "e35"}),
                               ("manager", {"e07", "e14"}), ("employee", set())):
            self.assertEqual(set(compare(role, october)), expected)

        # Comparison logins describe the current list, even for an employee active in October.
        day = dict(period="custom", start="2026-10-01", end="2026-10-01", compare="custom",
                   comparisonStart="2026-10-01", comparisonEnd="2026-10-31")
        personal = compare("employee", day)
        self.assertEqual(personal["e09"][2:], ["0", "7", "2026-10-28 08:00 UTC"])
        self.assertNotIn("e20", compare("admin", day))  # hired October 16
        selected = {**day, "org": "engineering", "attribute:clinical_service": "Acute care"}
        scoped = compare("manager", selected, "e04/e10")
        self.assertIn("e18", scoped)
        self.assertEqual(scoped["e18"][3], "4")  # only sign-ins before leaving North
        self.assertNotIn("e18", compare("manager", {**selected, "start": "2026-10-16", "end": "2026-10-16"}, "e04/e10"))
        self.assertTrue(all(r[3:] == ["—", "—"] for r in
                            compare("admin", {**day, "start": "2026-01-01", "end": "2026-01-01", "compare": "previous"}).values()))

    def test_weekly_boundary(self):
        monday = int(datetime(2026, 11, 23, 9, tzinfo=timezone.utc).timestamp())
        self.assertEqual(ws.next_run("weekly", "09:00", 0, monday - 1), monday)
        self.assertEqual(ws.next_run("weekly", "09:00", 0, monday), monday + 7 * 86400)


if __name__ == "__main__":
    unittest.main()
