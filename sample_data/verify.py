#!/usr/bin/env python3
"""Validate sample scenarios and cross-lifecycle reconciliations; no dependencies."""
import argparse
import json
import sqlite3
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHECKS = 0


def check(condition, description):
    global CHECKS
    if not condition:
        raise AssertionError(description)
    CHECKS += 1


def verify(path):
    db = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row

    def scalar(sql, args=()):
        return db.execute(sql, args).fetchone()[0]

    def zero(sql, description, args=()):
        rows = db.execute(sql, args).fetchall()
        check(not rows, f"{description}: {[tuple(r) for r in rows[:5]]}")

    check(scalar("PRAGMA integrity_check") == "ok", "SQLite file integrity")
    zero("PRAGMA foreign_key_check", "Composite tenant foreign keys")
    check(scalar("SELECT COUNT(*) FROM tenants") == 5, "Five independent tenant scenarios")
    check(scalar("SELECT COUNT(*) FROM employees") == 192, "Expected employee population")
    check(scalar("SELECT COUNT(*) FROM report_catalog") == 13, "All thirteen curated report families")
    check(scalar("SELECT COUNT(*) FROM platform_financial_allocations WHERE tenant_id<>'cedar'") == 0,
          "Ordinary programs require no specialized financial allocations")

    zero("""SELECT l.login_id FROM authentication_events l WHERE
      occurred_at > (SELECT value FROM dataset_metadata WHERE key='data_as_of') OR
      NOT EXISTS (SELECT 1 FROM employee_history h WHERE h.tenant_id=l.tenant_id AND h.employee_id=l.employee_id
        AND h.valid_from<=substr(l.occurred_at,1,10) AND (h.valid_to IS NULL OR h.valid_to>substr(l.occurred_at,1,10)))""",
         "Logins occur within a valid assignment and the snapshot")
    check(scalar("""SELECT COUNT(*) FROM (
      SELECT tenant_id FROM authentication_events WHERE login_method='one_time_pac'
      GROUP BY tenant_id HAVING COUNT(DISTINCT employee_id)=2 AND COUNT(*)=4
    )""") == 5, "Each customer has PAC-only and mixed-method examples in both periods")
    zero("""SELECT l.login_id FROM user_logins l JOIN authentication_events a USING(tenant_id,login_id)
      WHERE a.login_method='one_time_pac'""", "PAC sign-ins are excluded from the reporting population")
    # Exercise every example query, so the delivered queries are directly runnable.
    db.executescript((HERE / "queries.sql").read_text())
    check(True, "All example queries execute")

    zero("""SELECT a.* FROM eligibility a JOIN eligibility b
      ON a.tenant_id=b.tenant_id AND a.employee_id=b.employee_id AND a.program_id=b.program_id
      AND a.eligibility_id < b.eligibility_id
      AND a.valid_from < COALESCE(b.valid_to,'9999-12-31')
      AND b.valid_from < COALESCE(a.valid_to,'9999-12-31')""", "No overlapping eligibility intervals")
    zero("""SELECT a.* FROM employee_history a JOIN employee_history b
      ON a.tenant_id=b.tenant_id AND a.employee_id=b.employee_id AND a.history_id<b.history_id
      AND a.valid_from<COALESCE(b.valid_to,'9999-12-31')
      AND b.valid_from<COALESCE(a.valid_to,'9999-12-31')""", "No overlapping organizational history")

    zero("""WITH RECURSIVE boundaries(tenant_id,d) AS (
        SELECT tenant_id,valid_from FROM employee_history UNION
        SELECT tenant_id,valid_to FROM employee_history WHERE valid_to IS NOT NULL
      ), active AS (
        SELECT b.tenant_id,b.d,h.employee_id,h.manager_id FROM boundaries b JOIN employee_history h
          ON h.tenant_id=b.tenant_id AND h.valid_from<=b.d AND (h.valid_to IS NULL OR b.d<h.valid_to)
      ), reachable(tenant_id,d,employee_id) AS (
        SELECT tenant_id,d,employee_id FROM active WHERE manager_id IS NULL UNION
        SELECT a.tenant_id,a.d,a.employee_id FROM active a JOIN reachable r
          ON a.tenant_id=r.tenant_id AND a.d=r.d AND a.manager_id=r.employee_id
      ) SELECT tenant_id,d,employee_id FROM active EXCEPT SELECT * FROM reachable""",
      "Every active employee has a cycle-free chain of active managers")
    check(scalar("""SELECT count(DISTINCT tenant_id) FROM employee_history
        WHERE employee_id='e18' AND manager_id='e21' AND valid_from='2026-10-16'""") == 5,
        "Manager transfer present in each customer")

    # Independent ledger reconciliations prevent matching-looking but inconsistent dashboards.
    zero("""SELECT r.tenant_id,r.recognition_id,rr.employee_id,rr.points,
        (SELECT COALESCE(SUM(l.points_delta),0) FROM employee_points_ledger l
         WHERE l.tenant_id=r.tenant_id AND l.recognition_id=r.recognition_id AND l.employee_id=rr.employee_id AND l.kind='award') AS posted
      FROM recognitions r JOIN recognition_recipients rr USING(tenant_id,recognition_id)
      WHERE posted <> CASE WHEN r.status='approved' THEN rr.points ELSE 0 END""", "Approved recipient points reconcile to employee credits")
    zero("""SELECT r.tenant_id,r.recognition_id,rr.employee_id,rr.points,
        (SELECT COALESCE(-SUM(l.points_delta),0) FROM bank_ledger l
         WHERE l.tenant_id=r.tenant_id AND l.recognition_id=r.recognition_id AND l.recipient_id=rr.employee_id AND l.bank_id=rr.bank_id AND l.kind='award') AS posted
      FROM recognitions r JOIN recognition_recipients rr USING(tenant_id,recognition_id)
      WHERE posted <> CASE WHEN r.status='approved' THEN rr.points ELSE 0 END""", "Awards reconcile to actual funding bank debits")
    zero("""SELECT o.* FROM orders o WHERE o.points_spent <> COALESCE((
      SELECT -SUM(l.points_delta) FROM employee_points_ledger l
      WHERE l.tenant_id=o.tenant_id AND l.order_id=o.order_id AND l.kind='redemption'),0)""", "Orders reconcile to wallet redemptions")
    zero("""SELECT o.* FROM orders o WHERE o.value_minor <> (
      SELECT SUM(i.quantity*i.unit_value_minor) FROM order_items i
      WHERE i.tenant_id=o.tenant_id AND i.order_id=o.order_id)""", "Order values reconcile to line quantities and prices")
    zero("""SELECT i.* FROM order_items i WHERE i.quantity < COALESCE((
      SELECT SUM(s.quantity) FROM shipment_items s WHERE s.tenant_id=i.tenant_id
        AND s.order_id=i.order_id AND s.item_id=i.item_id),0)""", "No over-shipped item quantities")
    zero("""SELECT o.* FROM orders o JOIN milestone_entitlements m USING(tenant_id,entitlement_id)
      WHERE o.employee_id<>m.employee_id OR o.submitted_at<>m.redeemed_at
      OR o.points_spent<>COALESCE(m.required_points,0)""", "Milestone orders link to the correct redemption and funding mode")
    zero("""SELECT r.* FROM recognitions r WHERE NOT EXISTS (
      SELECT 1 FROM eligibility e WHERE e.tenant_id=r.tenant_id AND e.program_id=r.program_id
       AND e.employee_id=r.sender_id AND e.can_send=1
       AND substr(COALESCE(r.approved_at,r.submitted_at),1,10)>=e.valid_from
       AND (e.valid_to IS NULL OR substr(COALESCE(r.approved_at,r.submitted_at),1,10)<e.valid_to))""", "All senders eligible at the event boundary")
    zero("""SELECT rr.* FROM recognition_recipients rr JOIN recognitions r USING(tenant_id,recognition_id)
      WHERE NOT EXISTS (SELECT 1 FROM eligibility e WHERE e.tenant_id=r.tenant_id AND e.program_id=r.program_id
       AND e.employee_id=rr.employee_id AND e.can_receive=1
       AND substr(COALESCE(r.approved_at,r.submitted_at),1,10)>=e.valid_from
       AND (e.valid_to IS NULL OR substr(COALESCE(r.approved_at,r.submitted_at),1,10)<e.valid_to))""", "All recipients historically eligible")
    zero("""SELECT rr.* FROM recognition_recipients rr JOIN recognitions r USING(tenant_id,recognition_id)
      WHERE rr.points>0 AND (NOT EXISTS (SELECT 1 FROM bank_programs bp
        WHERE bp.tenant_id=r.tenant_id AND bp.bank_id=rr.bank_id AND bp.program_id=r.program_id)
       OR NOT EXISTS (SELECT 1 FROM bank_users bu WHERE bu.tenant_id=r.tenant_id
        AND bu.bank_id=rr.bank_id AND bu.employee_id=r.sender_id))""", "Actual funding respects bank program and user restrictions")
    zero("""SELECT * FROM (SELECT tenant_id,employee_id,transaction_id,
      SUM(points_delta) OVER(PARTITION BY tenant_id,employee_id ORDER BY occurred_at,transaction_id ROWS UNBOUNDED PRECEDING) AS balance
      FROM employee_points_ledger) WHERE balance<0""", "No negative historical employee balances")
    zero("""SELECT * FROM (SELECT tenant_id,bank_id,transaction_id,
      SUM(points_delta) OVER(PARTITION BY tenant_id,bank_id ORDER BY occurred_at,transaction_id ROWS UNBOUNDED PRECEDING) AS balance
      FROM bank_ledger) WHERE balance<0""", "No negative historical funding balances")
    zero("""SELECT * FROM v_official_recognition WHERE is_private=1 AND message IS NOT NULL""", "Private messages suppressed in semantic recognition view")

    october_counts = {"meridian": 19, "harbor": 15, "summit": 27, "atlas": 17, "cedar": 21}
    for tenant, expected in october_counts.items():
        def one(sql, *args):
            return scalar(sql, (tenant, *args))

        for table, timestamp in [("v_official_recognition", "activity_at"), ("user_logins", "occurred_at"),
                                 ("orders", "submitted_at"), ("milestone_entitlements", "redeemed_at"),
                                 ("bank_ledger", "occurred_at"), ("employee_points_ledger", "occurred_at")]:
            count = one(f"""SELECT COUNT(DISTINCT substr({timestamp},1,7)) FROM {table}
                        WHERE tenant_id=? AND {timestamp}>='2026-11-01' AND {timestamp}<'2028-01-01'""")
            check(count == 14, f"{tenant}: {table} covers every extension month through December 2027")
        check(one("SELECT COUNT(*) FROM v_official_recognition WHERE tenant_id=? AND activity_at>='2026-10-01T00:00:00Z' AND activity_at<'2026-11-01T00:00:00Z'") == expected,
              f"{tenant}: known October recognition total")
        check(one("SELECT COUNT(*) FROM v_official_recognition WHERE tenant_id=? AND recognition_id='r-multi'") == 1,
              f"{tenant}: five components and two recipients remain one event")
        check(one("SELECT points_awarded FROM v_official_recognition WHERE tenant_id=? AND recognition_id='r-multi'") == 250,
              f"{tenant}: multi-recipient points sum to 250")
        check(one("SELECT COUNT(*) FROM v_official_recognition WHERE tenant_id=? AND recognition_id IN ('r-pending','r-rejected','r-canceled','r-submitted')") == 0,
              f"{tenant}: approval boundary excludes all four operational statuses")
        check(one("SELECT COUNT(*) FROM v_official_recognition WHERE tenant_id=? AND recognition_id='r-approved-unissued' AND issued_at IS NULL") == 1,
              f"{tenant}: approval and issuance are independently measurable")
        check(one("SELECT COUNT(*) FROM v_milestone_nonresponders WHERE tenant_id=?") == 5,
              f"{tenant}: exactly five outstanding non-responders")
        for horizon, count in [(30, 1), (60, 2), (90, 3)]:
            check(one("SELECT COUNT(*) FROM v_milestone_state WHERE tenant_id=? AND entitlement_state='upcoming' AND eligible_on <= date((SELECT value FROM dataset_metadata WHERE key='data_as_of'), '+' || ? || ' days')", horizon) == count,
                  f"{tenant}: {horizon}-day upcoming count")
        check(one("SELECT COUNT(*) FROM v_milestone_nonresponders WHERE tenant_id=? AND entitlement_id='m-redeemed-delayed'") == 0,
              f"{tenant}: redeemed but delayed milestone excluded from non-responders")
        check(one("SELECT COUNT(*) FROM v_milestone_nonresponders WHERE tenant_id=? AND notification_status='failed'") == 1,
              f"{tenant}: notification exception remains visible")
        check(one("SELECT COUNT(*) FROM v_order_activity WHERE tenant_id=?") == 38,
              f"{tenant}: 38 unique orders across both sources")
        check(one("SELECT SUM(item_units) FROM v_order_activity WHERE tenant_id=?") == 42,
              f"{tenant}: 42 units are distinct from order count")
        check(one("SELECT COUNT(DISTINCT redemption_source) FROM v_order_activity WHERE tenant_id=?") == 2,
              f"{tenant}: both redemption sources")
        check(one("SELECT SUM(quantity) FROM shipment_items WHERE tenant_id=? AND order_id='o-points-partial'") == 2,
              f"{tenant}: partial shipment contains two of five units")
        check(one("SELECT COUNT(DISTINCT program_id) FROM recognitions r JOIN employee_points_ledger l USING(tenant_id,recognition_id) WHERE r.tenant_id=? AND l.employee_id='e09' AND l.kind='award'") == 2,
              f"{tenant}: two programs fund the same employee wallet")
        check(one("SELECT SUM(potential_points) FROM v_pending_commitments WHERE tenant_id=?") == 625,
              f"{tenant}: 625 potential points remain separate from actual bank spending")
        check(one("SELECT COUNT(*) FROM v_bank_balances WHERE tenant_id=?") == 3,
              f"{tenant}: shared banks counted once including unused reserve")
        check(one("SELECT COUNT(*) FROM report_grants WHERE tenant_id=? AND user_id IN ('employee','manager') AND report_id='R4'") == 0,
              f"{tenant}: employee and manager have no leaderboard grant")
        check(one("SELECT COUNT(*) FROM field_grants WHERE tenant_id=? AND user_id='owner' AND field_name='shipping_address'") == 0,
              f"{tenant}: owner order visibility does not expose shipping address")
        check(one("SELECT COUNT(DISTINCT approved_event_count) FROM report_runs WHERE tenant_id=?") == 1,
              f"{tenant}: recorded report surfaces reconcile")
        check(one("SELECT row_count FROM export_jobs WHERE tenant_id=? AND export_id='export-ready'") == expected+1,
              f"{tenant}: recipient-grain export has one extra row; event total still reconciles")
        check(one("SELECT COUNT(*) FROM report_runs WHERE tenant_id=? AND approved_event_count<>?", expected) == 0,
              f"{tenant}: stored report snapshots match authoritative October total")
        check(one("SELECT COUNT(*) FROM access_cases WHERE tenant_id=? AND case_id='cross-tenant' AND requested_tenant_id<>tenant_id AND expected_decision='deny'") == 1,
              f"{tenant}: cross-tenant negative access fixture")

    # A 24-person tenant has overlapping programs, not 48 distinct eligible senders.
    eligible = """FROM eligibility WHERE tenant_id='meridian' AND can_send=1 AND program_id IN ('peer','spot','care')
      AND valid_from<'2026-11-01' AND (valid_to IS NULL OR valid_to>'2026-10-01')"""
    check(scalar("SELECT COUNT(DISTINCT employee_id) "+eligible) == 24, "Merged sending denominator deduplicates programs")
    check(scalar("SELECT COUNT(*) "+eligible) == 48, "Individual sending denominators deliberately non-additive")
    check(scalar("""SELECT COUNT(DISTINCT employee_id) FROM eligibility WHERE tenant_id='meridian' AND program_id='peer'
      AND can_receive=1 AND valid_from<'2026-11-01' AND (valid_to IS NULL OR valid_to>'2026-10-01')""") == 16,
          "Peer receiving denominator uses the eligible receiving population, not tenant headcount")
    check(scalar("""SELECT SUM(allocated_points) FROM platform_financial_allocations WHERE tenant_id='cedar'""") == 470,
          "Platform allocations reconcile to the original and monthly redemptions")
    check(scalar("SELECT SUM(taxable_value_minor) FROM platform_financial_allocations WHERE tenant_id='cedar'") == 524,
          "Known platform-supplied taxable result is 524 USD minor units")
    check(scalar("SELECT SUM(funding_cost_minor) FROM platform_financial_allocations WHERE tenant_id='cedar'") == 378,
          "Funding cost is independent from points, tax and order value")
    zero("""SELECT * FROM export_jobs WHERE completed_at IS NOT NULL
      AND (completed_at<requested_at OR data_as_of>completed_at)""", "Completed export timestamps follow request and data watermark")
    for table in ("saved_views", "export_jobs", "report_runs"):
        for row in db.execute(f"SELECT filters_json FROM {table}"):
            check(isinstance(json.loads(row[0]), dict), f"{table}: valid filter metadata")
    zero("SELECT 1 FROM tenants WHERE currency != 'USD'", "All sample customers use US dollars")
    db.close()
    print(f"PASS: {CHECKS} dataset checks, including all 13 report families and example queries.")
    print("These checks validate the SQLite fixtures and metric reconciliations.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path, nargs="?", default=HERE / "reporting_poc.sqlite")
    verify(parser.parse_args().database)
