#!/usr/bin/env python3
"""Build deterministic, wholly fictional reporting fixtures. Python stdlib only."""
import argparse
import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
AS_OF = "2026-11-10T16:00:00Z"
TODAY = date(2026, 11, 10)
PROFILES = [
    ("meridian", "Meridian Labs", "Recognition, values, participation and historical eligibility", 24, "America/Chicago", "USD", 0),
    ("harbor", "Harbor Health", "Milestone pipeline, non-responders and notification exceptions", 40, "America/New_York", "USD", 0),
    ("summit", "Summit Retail", "Shared employee wallets, unified orders and fulfillment", 60, "America/Denver", "USD", 0),
    ("atlas", "Atlas Industrial", "Many-to-many funding banks, budgets and approval investigation", 32, "America/Chicago", "USD", 0),
    ("cedar", "Cedar Global", "Restricted reporting, financial extensions and asynchronous exports", 36, "Europe/London", "USD", 1),
]
CUSTOM_ATTRIBUTES = {
    "meridian": ("research_group", ("Discovery", "Translational", "Clinical")),
    "harbor": ("clinical_service", ("Acute care", "Outpatient", "Community health")),
    "summit": ("store_format", ("Flagship", "Neighborhood", "Outlet")),
    "atlas": ("production_line", ("Assembly", "Machining", "Packaging")),
    "cedar": ("business_unit", ("Advisory", "Operations", "Technology")),
}
REPORTS = {
    "U1": "User Logins",
    "R1": "Recognition Activity and Timeline", "R2": "Recognition Categories and Values",
    "R3": "Recognition Program Performance", "R4": "Recognition Leaderboards",
    "M1": "Milestone Awards Overview and Upcoming Milestones", "M2": "Milestone Non-Responders and Activity",
    "P1": "Employee Points Balance and Activity", "O1": "Order Activity and Timeline",
    "O2": "Fulfillment Exceptions and Performance", "B1": "Point Bank and Budget Utilization",
    "I1": "Recognition Status and Approval Investigation", "F1": "Financial and Taxable-Benefit Reports",
}
FIRST = ["Alex", "Blair", "Casey", "Drew", "Emery", "Finley", "Gray", "Harper", "Indigo", "Jules", "Kai", "Lane"]
LAST = ["Demo", "Sample", "Example", "Fixture", "Test"]


def js(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def stamp(day, hour=12):
    return f"{day}T{hour:02d}:00:00Z"


def shifted(day, days):
    return (date.fromisoformat(day) + timedelta(days=days)).isoformat()


def insert(db, table, **values):
    columns = ",".join(values)
    db.execute(f"INSERT INTO {table} ({columns}) VALUES ({','.join('?' for _ in values)})", tuple(values.values()))


def seed_tenant(db, profile):
    tid, name, scenario, size, timezone, currency, fifo = profile

    def put(table, **values):
        insert(db, table, tenant_id=tid, **values)

    def wallet(tx, employee, kind, delta, at, recognition=None, order=None, reason=None):
        put("employee_points_ledger", transaction_id=tx, employee_id=employee, kind=kind,
            points_delta=delta, occurred_at=at, recognition_id=recognition, order_id=order, reason=reason)

    def bank(tx, bank_id, kind, delta, at, recognition=None, recipient=None, reason=None):
        put("bank_ledger", transaction_id=tx, bank_id=bank_id, kind=kind,
            points_delta=delta, occurred_at=at, recognition_id=recognition, recipient_id=recipient, reason=reason)

    for org, label, parent in [("root", name, None), ("north", "North Division", "root"),
                               ("south", "South Division", "root"), ("operations", "Operations", "north"),
                               ("engineering", "Engineering", "north"), ("service", "Customer Service", "south")]:
        put("organizations", org_id=org, name=label, parent_org_id=parent)

    custom_key, custom_values = CUSTOM_ATTRIBUTES[tid]
    for i in range(1, size + 1):
        eid = f"e{i:02d}"
        start = "2026-10-16" if i == 20 else "2020-01-01"
        end = "2026-10-21" if i == 19 else None
        put("employees", employee_id=eid, display_name=f"{FIRST[(i-1)%12]} {LAST[(i-1)//12]} {tid.title()}",
            email=f"{eid}@{tid}.example.invalid", hired_on=start,
            terminated_on="2026-10-20" if i == 19 else None)
        org = "operations" if i <= 8 else "engineering" if i <= 16 else "service"
        attrs = {"region": "North" if i <= 16 else "South", "cost_center": f"CC-{(i-1)//8+1:02d}",
                 "employment_type": "part_time" if i % 7 == 0 else "full_time",
                 "location": "London" if tid == "cedar" else "Springfield", "job_level": "L2" if i > 8 else "L4"}
        attrs[custom_key] = custom_values[(i - 1) % len(custom_values)]
        # The North manager has two team leads. Service reports through its own lead.
        managers = {17: None, 4: "e17", 21: "e17", 1: "e04", 10: "e04"}
        manager = managers.get(i, {"operations": "e01", "engineering": "e10", "service": "e21"}[org])
        if i == 18:
            put("employee_history", history_id=eid+"-old", employee_id=eid, org_id="engineering", manager_id="e10",
                valid_from=start, valid_to="2026-10-16", attributes_json=js({**attrs, "region": "North", "cost_center": "CC-02", custom_key: custom_values[0]}))
            start_history = "2026-10-16"
        else:
            start_history = start
        put("employee_history", history_id=eid+"-current", employee_id=eid, org_id=org, manager_id=manager,
            valid_from=start_history, valid_to=end, attributes_json=js(attrs))

        # Weekly patterns, repeat sign-ins and employees with no sign-ins.
        # Hire and termination dates bound each employee's account activity.
        first = date(2026, 1, 1) + timedelta(days=(i + size) % 7)
        interval = timedelta(days=3 + (i + size) % 8)
        while i % 7 and first <= TODAY:
            day = first.isoformat()
            if start <= day and (not end or day < end):
                for hour in ([8, 14] if (first.day + i) % 4 == 0 else [8]):
                    put("user_logins", login_id=f"{eid}-{day}-{hour}", employee_id=eid, occurred_at=stamp(day, hour))
            first += interval

    for pid, label, kind, monetary in [
        ("peer", "Everyday Thanks", "recognition", 1), ("spot", "Above and Beyond", "recognition", 1),
        ("care", "Values in Action", "recognition", 0), ("milestone", "Career Moments", "milestone", 0)]:
        put("programs", program_id=pid, name=label, program_type=kind, monetary=monetary)
        for i in range(1, size + 1):
            if pid == "peer" and i > size - 4:
                continue
            start = "2026-10-16" if i == 20 else "2020-01-01"
            end = "2026-10-21" if i == 19 else None
            put("eligibility", eligibility_id=f"{pid}-e{i:02d}", employee_id=f"e{i:02d}", program_id=pid,
                can_send=int(pid != "milestone" and (pid == "care" or i <= (16 if pid == "peer" else 8))),
                can_receive=int(pid in ("care", "milestone") or i >= 5), valid_from=start, valid_to=end)

    for bid, label in [("shared", "Shared Recognition Fund"), ("north-fund", "North Division Fund"), ("reserve", "Unallocated Reserve")]:
        put("funding_banks", bank_id=bid, name=label)
        bank(bid+"-opening", bid, "opening", 50000 if bid == "shared" else 20000, stamp("2026-01-01", 0))
    for bid, pid in [("shared", "peer"), ("shared", "spot"), ("north-fund", "peer")]:
        put("bank_programs", bank_id=bid, program_id=pid)
    for i in range(1, 9):
        for bid in ("shared", "north-fund"):
            put("bank_users", bank_id=bid, employee_id=f"e{i:02d}")
    bank("shared-top-up", "shared", "top_up", 10000, stamp("2026-10-01", 0))
    bank("north-adjustment", "north-fund", "adjustment", -250, stamp("2026-10-15"), reason="Synthetic funding correction")
    for i in range(1, size + 1):
        if i != 20:
            wallet(f"opening-e{i:02d}", f"e{i:02d}", "opening", 1000 if i <= 16 else 200, stamp("2026-01-01", 0))
    wallet("large-opening", "e16", "adjustment", 20000, stamp("2026-06-01"), reason="Migrated points adjustment; large-balance fixture")

    def recognition(rid, pid, sender, recipients, approved_day="2026-10-05", status="approved",
                    private=False, components=None, categories=None, values=None, submitted=None, issued=True):
        approved_at = stamp(approved_day) if status == "approved" else None
        submitted_at = submitted or stamp(approved_day, 9)
        # Recipients are (employee_id, points, actual funding bank).
        message = "Synthetic private recognition message" if private else f"Thank you for demonstrating our values ({rid})."
        put("recognitions", recognition_id=rid, program_id=pid, sender_id=sender, status=status,
            submitted_at=submitted_at, approved_at=approved_at,
            issued_at=stamp(approved_day, 13) if approved_at and issued else None,
            notified_at=stamp(approved_day, 14) if approved_at and issued else None,
            is_private=int(private), message=message,
            current_stage="director" if status == "pending" else "manager" if status == "submitted" else None,
            responsible_approver_id="e02" if status in ("submitted", "pending") else None)
        for eid, points, bid in recipients:
            put("recognition_recipients", recognition_id=rid, employee_id=eid, points=points, bank_id=bid)
            if status == "approved" and points:
                wallet(f"award-{rid}-{eid}", eid, "award", points, approved_at, recognition=rid)
                bank(f"award-{rid}-{eid}", bid, "award", -points, approved_at, recognition=rid, recipient=eid)
        if components is None:
            components = ["message", "badge"] + (["points"] if any(r[1] for r in recipients) else [])
        for component in components:
            put("recognition_components", recognition_id=rid, component=component,
                template_id="certificate-standard-v1" if component == "certificate" else "ecard-thanks-v1" if component == "ecard" else None)
        for kind, labels in [("category", categories or ["Customer impact"]), ("value", values or ["Collaboration"])]:
            for label in labels:
                put("recognition_tags", recognition_id=rid, tag_type=kind, label=label)
        put("approval_events", approval_event_id=rid+"-submitted", recognition_id=rid,
            stage="submission", action="submitted", actor_id=sender, occurred_at=submitted_at, reason=None)
        if status != "submitted":
            put("approval_events", approval_event_id=rid+"-manager", recognition_id=rid,
                stage="manager", action="approved" if status in ("approved", "pending") else status,
                actor_id="e02", occurred_at=stamp(approved_day, 10),
                reason="Outside program policy" if status == "rejected" else "Withdrawn by sender" if status == "canceled" else "Manager reviewed")
        if status == "approved":
            put("approval_events", approval_event_id=rid+"-final", recognition_id=rid, stage="director",
                action="approved", actor_id="e03", occurred_at=approved_at, reason="Final approval")

    # Eleven months of deterministic activity, with different org sizes and usage volumes.
    volume = {"meridian": 12, "harbor": 8, "summit": 20, "atlas": 10, "cedar": 14}[tid]
    for month in range(1, 12):
        for j in range(volume):
            day = f"2026-{month:02d}-{j % 8 + 1:02d}"
            pid = ("peer", "spot", "care")[j % 3]
            eid = f"e{9 + j % 8:02d}"
            bid = "north-fund" if pid == "peer" and j % 2 == 0 else "shared"
            points = 0 if pid == "care" else 25 * (j % 4 + 1)
            rid = f"r-{month:02d}-{j:02d}"
            recognition(rid, pid, f"e{j % 4 + 1:02d}", [(eid, points, bid if points else None)], day,
                        categories=[("Customer impact", "Innovation", "Teamwork")[j % 3]],
                        values=[("Collaboration", "Ownership", "Care")[j % 3]])
            if j % 4 == 0:
                for kind in ("like", "comment"):
                    put("social_events", social_event_id=f"{rid}-{kind}", recognition_id=rid,
                        employee_id="e05", kind=kind, occurred_at=stamp(day, 15),
                        comment_text="Great work! (synthetic)" if kind == "comment" else None)

    recognition("r-multi", "peer", "e01", [("e09", 100, "shared"), ("e10", 150, "shared")],
                components=["ecard", "badge", "points", "message", "certificate"],
                categories=["Customer impact", "Teamwork"], values=["Collaboration", "Ownership"])
    recognition("r-private", "care", "e02", [("e11", 0, None)], private=True)
    recognition("r-boundary", "peer", "e01", [("e12", 50, "north-fund")], "2026-10-01",
                submitted="2026-09-30T23:50:00Z")
    # Issuance deliberately occurs in a different reporting day from approval.
    db.execute("UPDATE recognitions SET issued_at=?, notified_at=? WHERE tenant_id=? AND recognition_id='r-boundary'",
               ("2026-10-02T00:05:00Z", "2026-10-02T00:06:00Z", tid))
    recognition("r-approved-unissued", "spot", "e03", [("e13", 75, "shared")], "2026-11-09", issued=False)
    for rid, status, amount in [("r-pending", "pending", 500), ("r-rejected", "rejected", 200),
                                ("r-canceled", "canceled", 1000), ("r-submitted", "submitted", 125)]:
        recognition(rid, "spot", "e01", [("e14", amount, "shared")], "2026-11-08", status=status)
    recognition("r-new-hire", "care", "e01", [("e20", 0, None)], "2026-10-20")
    recognition("r-before-transfer", "care", "e18", [("e15", 0, None)], "2026-10-10")
    recognition("r-after-transfer", "care", "e18", [("e15", 0, None)], "2026-10-20")
    recognition("r-before-termination", "peer", "e01", [("e19", 50, "shared")], "2026-10-19")
    recognition("r-fin-a", "peer", "e01", [("e09", 300, "shared")], "2026-02-01")
    recognition("r-fin-b", "spot", "e02", [("e09", 200, "shared")], "2026-03-01")

    # Non-normal award reversal policy remains open: seed a paired correction,
    # not an invented post-approval recognition status transition.
    wallet("wallet-correction", "e12", "adjustment", -25, stamp("2026-10-22"), reason="Platform-supplied balance correction, not a canceled recognition")
    bank("bank-correction", "north-fund", "reversal", 25, stamp("2026-10-22"), reason="Platform-supplied funding correction")
    wallet("wallet-expiry", "e11", "expiry", -50, stamp("2026-10-31"), reason="Expired legacy opening points")

    # Entitlement lifecycle is independent from both recognition and fulfillment.
    milestone_specs = [
        ("m-upcoming-15", "e21", "service_anniversary", 15, None, None, "not_due", None, "entitlement"),
        ("m-upcoming-45", "e22", "retirement", 45, None, None, "not_due", None, "entitlement"),
        ("m-upcoming-75", "e23", "certification", 75, None, None, "not_due", None, "entitlement"),
        ("m-upcoming-100", "e24", "service_anniversary", 100, None, None, "not_due", None, "entitlement"),
        ("m-unredeemed-10", "e17", "service_anniversary", -10, -10, None, "delivered", 80, "entitlement"),
        ("m-unredeemed-35", "e18", "retirement", -35, -35, None, "delivered", None, "entitlement"),
        ("m-unredeemed-65", "e21", "certification", -65, -65, None, "delivered", 25, "entitlement"),
        ("m-unredeemed-100", "e22", "service_anniversary", -100, -100, None, "delivered", None, "entitlement"),
        ("m-notification-failed", "e23", "service_anniversary", -12, None, None, "failed", 78, "entitlement"),
        ("m-redeemed-delayed", "e17", "service_anniversary", -50, -50, -40, "delivered", None, "entitlement"),
        ("m-redeemed-delivered", "e18", "retirement", -30, -30, -25, "delivered", None, "entitlement"),
        ("m-expired", "e24", "certification", -120, -120, None, "delivered", -1, "entitlement"),
        ("m-points-funded", "e10", "certification", -20, -20, -10, "delivered", None, "employee_points"),
    ]
    for mid, eid, kind, offset, notified, redeemed, notification, expiry, funding in milestone_specs:
        eligible = (TODAY + timedelta(days=offset)).isoformat()
        put("milestone_entitlements", entitlement_id=mid, employee_id=eid, program_id="milestone",
            milestone_type=kind, milestone_date=eligible, eligible_on=eligible,
            notified_at=stamp((TODAY+timedelta(days=notified)).isoformat()) if notified is not None else None,
            notification_status=notification, expires_on=(TODAY+timedelta(days=expiry)).isoformat() if expiry is not None else None,
            redeemed_at=stamp((TODAY+timedelta(days=redeemed)).isoformat()) if redeemed is not None else None,
            award_value_minor=15000 if kind == "retirement" else 5000,
            funding_mode=funding, required_points=150 if funding == "employee_points" else None)
        for event_kind, event_offset in [("eligible", offset), ("notified", notified), ("redeemed", redeemed)]:
            if event_offset is not None and event_offset <= 0:
                put("milestone_events", milestone_event_id=f"{mid}-{event_kind}", entitlement_id=mid,
                    kind=event_kind, occurred_at=stamp((TODAY+timedelta(days=event_offset)).isoformat()), detail=None)
        if notification == "failed":
            put("milestone_events", milestone_event_id=mid+"-failed", entitlement_id=mid,
                kind="notification_failed", occurred_at=stamp(eligible, 13), detail="Synthetic email delivery failure")
        if expiry is not None and expiry <= 0:
            put("milestone_events", milestone_event_id=mid+"-expired", entitlement_id=mid,
                kind="expired", occurred_at=stamp((TODAY+timedelta(days=expiry)).isoformat(), 0), detail=None)

    order_specs = [
        ("o-points-delivered", "e09", "points", None, "2026-10-03", "delivered", 120),
        ("o-points-partial", "e10", "points", None, "2026-10-15", "partially_shipped", 90),
        ("o-points-failed", "e11", "points", None, "2026-10-28", "failed", 60),
        ("o-points-canceled", "e12", "points", None, "2026-10-29", "canceled", 80),
        ("o-points-processing", "e13", "points", None, "2026-10-01", "processing", 100),
        ("o-points-shipped", "e14", "points", None, "2026-11-06", "shipped", 50),
        ("o-points-submitted", "e15", "points", None, "2026-11-10", "submitted", 40),
        ("o-milestone-delayed", "e17", "milestone", "m-redeemed-delayed", "2026-10-01", "processing", 0),
        ("o-milestone-delivered", "e18", "milestone", "m-redeemed-delivered", "2026-10-16", "delivered", 0),
        ("o-milestone-points", "e10", "milestone", "m-points-funded", "2026-10-31", "delivered", 150),
    ]
    for oid, eid, source, mid, day, status, spent in order_specs:
        # Five units on a two-line partial order; all other orders contain one unit.
        item_specs = [("i1", "MUG-DEMO", "Demo mug", 2, 1200), ("i2", "NOTE-DEMO", "Demo notebook", 3, 700)] if status == "partially_shipped" else [
            ("i1", "AWARD-DEMO" if mid else "REWARD-DEMO", "Synthetic milestone award" if mid else "Synthetic reward", 1, 15000 if mid == "m-redeemed-delivered" else 5000 if mid else 2500)]
        value = sum(quantity * price for _, _, _, quantity, price in item_specs)
        put("orders", order_id=oid, employee_id=eid, redemption_source=source, entitlement_id=mid,
            submitted_at=stamp(day), status=status, points_spent=spent, value_minor=value,
            fulfillment_cost_minor=0 if status in ("failed", "canceled", "submitted") else 450,
            shipping_address=f"{int(eid[1:])} Fictional Example Lane, Demo City, ZZ 00000",
            internal_notes="Synthetic operational note; restricted field")
        for item, sku, desc, quantity, price in item_specs:
            put("order_items", order_id=oid, item_id=item, sku=sku, description=desc, quantity=quantity, unit_value_minor=price)
        transitions = [("submitted", day)]
        if status != "submitted":
            transitions.append(("processing", shifted(day, 1)))
        if status in ("shipped", "partially_shipped", "delivered", "failed", "canceled"):
            transitions.append((status if status != "delivered" else "shipped", shifted(day, 2)))
        if status == "delivered":
            transitions.append(("delivered", shifted(day, 4)))
        for n, (state, event_day) in enumerate(transitions):
            put("order_events", order_event_id=f"{oid}-{n}", order_id=oid, status=state,
                occurred_at=stamp(event_day), exception_code="SUPPLIER_FAILURE" if state == "failed" else None,
                detail="Synthetic status event")
        if status == "processing":
            put("order_events", order_event_id=oid+"-delay", order_id=oid, status="processing",
                occurred_at=stamp("2026-11-01"), exception_code="BACKORDER", detail="Awaiting supplier stock")
        if status in ("delivered", "shipped", "partially_shipped"):
            sid = oid+"-shipment-1"
            put("shipments", shipment_id=sid, order_id=oid, carrier="Demo Carrier",
                tracking_reference="SYNTHETIC-"+tid+"-"+oid,
                shipped_at=stamp(shifted(day, 2)), delivered_at=stamp(shifted(day, 4)) if status == "delivered" else None)
            for item, _, _, quantity, _ in item_specs:
                if status != "partially_shipped" or item == "i1":
                    put("shipment_items", shipment_id=sid, order_id=oid, item_id=item, quantity=quantity)
        if spent:
            wallet("redeem-"+oid, eid, "redemption", -spent, stamp(day), order=oid)
            if status in ("failed", "canceled"):
                wallet("refund-"+oid, eid, "refund", spent, stamp(shifted(day, 2)), order=oid, reason="Full synthetic refund")

    if fifo:
        # Platform allocation fixture: the platform has supplied lot choices.
        for key, award, points, funding_cost, liability, taxable in [
            ("a1", "award-r-fin-a-e09", 100, 80, 90, 110),
            ("a2", "award-r-fin-b-e09", 20, 18, 19, 22),
        ]:
            put("platform_financial_allocations", allocation_id=key, employee_id="e09",
                award_transaction_id=award, redemption_transaction_id="redeem-o-points-delivered",
                allocated_points=points, funding_cost_minor=funding_cost, liability_released_minor=liability,
                taxable_value_minor=taxable, tax_jurisdiction="GB-DEMO", source_calculation_id="PLATFORM-SYNTHETIC-2026-001")

    seed_reporting(db, tid, put, fifo)


def seed_reporting(db, tid, put, fifo):
    for uid, eid, role in [("owner", "e01", "program_owner"), ("admin", "e02", "administrator"),
                           ("service", "e03", "customer_service"), ("manager", "e04", "manager"),
                           ("employee", "e09", "employee"), ("finance", "e05", "finance_analyst")]:
        put("reporting_users", user_id=uid, employee_id=eid, role=role)
    for uid in ("owner", "admin"):
        for report in REPORTS:
            if report == "U1" and uid != "admin":
                continue
            if report == "F1" and (not fifo or uid != "admin"):
                continue
            # Owner manages recognition North + tenant-wide milestone operations.
            if uid == "owner" and report in ("R1", "R2", "R3", "R4", "B1", "I1"):
                for pid in ("peer", "spot", "care"):
                    put("report_grants", grant_id=f"{uid}-{report}-{pid}", user_id=uid, report_id=report,
                        program_id=pid, org_id="north", include_descendants=1)
            else:
                put("report_grants", grant_id=f"{uid}-{report}", user_id=uid, report_id=report,
                    program_id=None, org_id=None, include_descendants=1)
    for report in ("R1", "R2", "M1", "M2", "U1"):
        put("report_grants", grant_id="team-"+report, user_id="manager", report_id=report,
            program_id=None, org_id="north", include_descendants=1)
    for report in ("M1", "P1", "O1", "U1"):
        put("report_grants", grant_id="personal-"+report, user_id="employee", report_id=report,
            program_id=None, org_id=None, include_descendants=0, self_only=1)
    for report in ("O1", "O2", "I1"):
        put("report_grants", grant_id="service-"+report, user_id="service", report_id=report,
            program_id=None, org_id="south", include_descendants=1)
    if fifo:
        put("report_grants", grant_id="finance-F1", user_id="finance", report_id="F1",
            program_id=None, org_id=None, include_descendants=1)
    for uid in ("admin", "manager", "employee"):
        for key in ("region", "location", "cost_center", "employment_type", "job_level", CUSTOM_ATTRIBUTES[tid][0]):
            put("field_grants", user_id=uid, field_name="attribute:" + key)
    for uid, fields in {
        "admin": ["recognition_message", "employee_balance", "shipping_address", "internal_notes", "approval_reason"] + (["financial_allocations"] if fifo else []),
        "employee": ["employee_balance"],
        "owner": ["recognition_message", "employee_balance", "approval_reason"],
        "service": ["shipping_address", "approval_reason"],
        "finance": ["financial_allocations"] if fifo else [],
    }.items():
        for field in fields:
            put("field_grants", user_id=uid, field_name=field)
    filters = {"start": "2026-10-01T00:00:00Z", "end_exclusive": "2026-11-01T00:00:00Z",
               "timezone": "UTC", "date_basis": "approved_at", "status": "approved"}
    for vid, uid, report, label, filter_value, columns in [
        ("october-activity", "admin", "R1", "October approved activity", filters, ["recognition_id", "activity_at", "points_awarded"]),
        ("aging-milestones", "owner", "M2", "Outstanding 30+ days", {"minimum_age_days": 30}, ["employee_id", "milestone_type", "outstanding_age_days"]),
        ("delayed-orders", "service", "O2", "Delayed southern orders", {"org_id": "south", "status": "processing"}, ["order_id", "status", "submitted_at"]),
    ]:
        put("saved_views", view_id=vid, user_id=uid, report_id=report, name=label,
            filters_json=js(filter_value), columns_json=js(columns))
    put("report_schedules", schedule_id="weekly-milestones", view_id="aging-milestones",
        cron_expression="0 8 * * 1", timezone="America/Chicago", recipient_user_id="owner", enabled=1,
        next_run_at="2026-11-16T14:00:00Z")
    raw_columns = ["recognition_id", "sender_id", "recipient_id", "submitted_at", "approved_at", "issued_at",
                   "notified_at", "components", "categories", "values", "points", "bank_id", "message"]
    count = db.execute("SELECT COUNT(*) FROM v_official_recognition WHERE tenant_id=? AND activity_at>=? AND activity_at<?",
                       (tid, filters["start"], filters["end_exclusive"])).fetchone()[0]
    raw_rows = db.execute("SELECT COUNT(*) FROM v_official_recognition r JOIN recognition_recipients rr USING(tenant_id,recognition_id) WHERE r.tenant_id=? AND activity_at>=? AND activity_at<?",
                          (tid, filters["start"], filters["end_exclusive"])).fetchone()[0]
    for surface in ("dashboard", "curated_report", "detail_export"):
        put("report_runs", run_id="october-"+surface, report_id="R1", surface=surface,
            filters_json=js(filters), data_as_of=AS_OF, definition_version="poc-v1-approval-utc",
            approved_event_count=count)
    for xid, status, completed, expiry, link, failure in [
        ("export-ready", "completed", "2026-11-10T17:01:00Z", "2026-11-11T17:01:00Z", "https://downloads.example.invalid/placeholder/ready", None),
        ("export-queued", "queued", None, None, None, None),
        ("export-running", "running", None, None, None, None),
        ("export-expired", "expired", "2026-11-08T17:01:00Z", "2026-11-09T17:01:00Z", None, None),
        ("export-revoked", "failed", None, None, None, "Authorization revoked before scheduled delivery"),
    ]:
        old = xid == "export-expired"
        put("export_jobs", export_id=xid, user_id="admin", report_id="R1", status=status,
            requested_at="2026-11-08T17:00:00Z" if old else "2026-11-10T17:00:00Z",
            completed_at=completed, data_as_of="2026-11-08T16:59:00Z" if old else AS_OF,
            filters_json=js(filters), columns_json=js(raw_columns),
            row_count=raw_rows if status in ("completed", "expired") else None,
            expires_at=expiry, download_link_placeholder=link, failure_reason=failure)
    put("delivery_events", delivery_id="ready-email", export_id="export-ready", recipient_user_id="admin",
        channel="email", status="sent_fixture_only", occurred_at="2026-11-10T17:02:00Z")
    put("delivery_events", delivery_id="revoked-blocked", export_id="export-revoked", recipient_user_id="admin",
        channel="email", status="blocked_permission_recheck", occurred_at="2026-11-10T17:02:00Z")
    other = "cedar" if tid != "cedar" else "meridian"
    for cid, uid, resource, target, decision, explanation in [
        ("manager-leaderboard", "manager", "R4", tid, "deny", "Manager role has no owner-report grant"),
        ("employee-leaderboard", "employee", "R4", tid, "deny", "Program eligibility does not authorize owner reports"),
        ("owner-leaderboard", "owner", "R4:peer:north", tid, "allow", "Explicit program and organizational grant"),
        ("owner-south", "owner", "R4:peer:south", tid, "deny", "Organization outside owner scope"),
        ("cross-tenant", "admin", "R1", other, "deny", "Administrative rights remain tenant-scoped"),
        ("owner-address", "owner", "O1.shipping_address", tid, "redact", "Status visibility does not grant address visibility"),
        ("service-balance", "service", "P1.employee_balance", tid, "deny", "No P1 report or balance field grant"),
        ("private-message", "admin", "R1:r-private.message", tid, "redact", "Private message always suppressed under POC policy"),
        ("expired-link", "admin", "export-expired.download", tid, "deny", "Link expired; recheck on access"),
        ("revoked-delivery", "admin", "export-revoked.delivery", tid, "deny", "Historical permission-revocation fixture"),
    ]:
        put("access_cases", case_id=cid, user_id=uid, resource=resource, requested_tenant_id=target,
            expected_decision=decision, explanation=explanation)


def make_manifest(db):
    scenarios = []
    for profile in PROFILES:
        tid = profile[0]
        counts = {table: db.execute(f"SELECT COUNT(*) FROM {table} WHERE tenant_id=?", (tid,)).fetchone()[0]
                  for table in ("employees", "user_logins", "recognitions", "milestone_entitlements", "orders", "employee_points_ledger", "bank_ledger")}
        october = db.execute("SELECT approved_event_count FROM report_runs WHERE tenant_id=? AND surface='dashboard'", (tid,)).fetchone()[0]
        scenarios.append({"tenant_id": tid, "name": profile[1], "focus": profile[2], "counts": counts,
                          "october_approved_events": october,
                          "october_approved_points": db.execute("SELECT SUM(points_awarded) FROM v_official_recognition WHERE tenant_id=? AND activity_at>='2026-10-01T00:00:00Z' AND activity_at<'2026-11-01T00:00:00Z'", (tid,)).fetchone()[0]})
    return {"data_as_of": AS_OF, "synthetic": True, "definition_version": "poc-v1-approval-utc", "scenarios": scenarios}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=HERE / "reporting_poc.sqlite")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Generate atomically so a failed run does not replace the usable sample.
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    if temporary.exists():
        temporary.unlink()
    db = sqlite3.connect(temporary)
    try:
        db.executescript((HERE / "schema.sql").read_text())
        for key, value in {
            "data_as_of": AS_OF, "synthetic": "true", "definition_version": "poc-v1-approval-utc",
            "time_policy": "UTC timestamps; half-open periods; approval date basis",
            "eligibility_policy": "Distinct employees eligible at any time in selected period; separate send/receive",
            "private_message_policy": "Always NULL in reporting views, including for administrators; provisional",
            "small_population_threshold": "5", "money_unit": "Integer minor currency units; points are not money",
            "source_note": "All records including platform financial values are invented fixtures, not production exports",
        }.items():
            insert(db, "dataset_metadata", key=key, value=value)
        for report, name in REPORTS.items():
            insert(db, "report_catalog", report_id=report, name=name, owner_only=int(report == "R4"))
        # Insert tenant identities first so negative cross-tenant cases have valid references.
        for profile in PROFILES:
            insert(db, "tenants", tenant_id=profile[0], name=profile[1], scenario=profile[2],
                   timezone=profile[4], currency=profile[5], fifo_enabled=profile[6])
        for profile in PROFILES:
            seed_tenant(db, profile)
        failures = db.execute("PRAGMA foreign_key_check").fetchall()
        if failures:
            raise ValueError(f"Foreign key errors: {failures}")
        manifest = make_manifest(db)
        db.commit()
    finally:
        db.close()
    temporary.replace(args.output)
    manifest_path = args.output.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Created {args.output}\nCreated {manifest_path}")
    for scenario in manifest["scenarios"]:
        print(f"  {scenario['tenant_id']}: {scenario['counts']['employees']} employees, "
              f"{scenario['counts']['recognitions']} recognition requests, "
              f"{scenario['october_approved_events']} approved October events")


if __name__ == "__main__":
    main()
