-- Run: sqlite3 -header -column sample_data/reporting_poc.sqlite < sample_data/queries.sql
-- Developer examples against fictional fixtures. These queries do not apply user grants.
-- UTC periods are half-open. Every join on tenant-owned data includes tenant_id.

-- R1 / R3: October activity, at EVENT grain (recipient/component joins cannot inflate it).
SELECT tenant_id, program_id, COUNT(*) AS approved_events,
       COUNT(DISTINCT sender_id) AS distinct_senders, SUM(points_awarded) AS points_awarded
FROM v_official_recognition
WHERE tenant_id='meridian' AND activity_at >= '2026-10-01T00:00:00Z'
  AND activity_at < '2026-11-01T00:00:00Z'
GROUP BY tenant_id, program_id;

-- R1: monthly trend and engagement. Social measures have their own grain.
WITH social AS (
  SELECT tenant_id, recognition_id,
         SUM(kind='like') AS likes, SUM(kind='comment') AS comments
  FROM social_events WHERE occurred_at <= (SELECT value FROM dataset_metadata WHERE key='data_as_of')
  GROUP BY tenant_id, recognition_id
)
SELECT substr(r.activity_at, 1, 7) AS month, COUNT(*) AS events,
       SUM(COALESCE(s.likes,0)) AS likes, SUM(COALESCE(s.comments,0)) AS comments
FROM v_official_recognition r LEFT JOIN social s USING (tenant_id,recognition_id)
WHERE r.tenant_id='meridian' GROUP BY month ORDER BY month;

-- R2: value breakdown is NON-ADDITIVE. r-multi belongs to two values but is one event.
SELECT t.label AS value, COUNT(DISTINCT r.recognition_id) AS events
FROM v_official_recognition r JOIN recognition_tags t USING (tenant_id, recognition_id)
WHERE r.tenant_id='meridian' AND t.tag_type='value'
  AND r.activity_at >= '2026-10-01T00:00:00Z' AND r.activity_at < '2026-11-01T00:00:00Z'
GROUP BY t.label;

-- R3: historical sending/receiving participation by program AND consolidated.
-- Denominator: unique employees eligible for >=1 instant in the selected period.
-- Numerator: unique participants whose event time falls inside their own eligibility.
-- Scope and org filters, if added, must constrain BOTH populations identically.
WITH windows AS (
  SELECT '2026-10-01T00:00:00Z' AS start_at, '2026-11-01T00:00:00Z' AS end_at
), eligible AS (
  SELECT e.* FROM eligibility e CROSS JOIN windows w
  WHERE e.tenant_id='meridian' AND e.program_id IN ('peer','spot','care')
    AND e.valid_from < substr(w.end_at,1,10)
    AND (e.valid_to IS NULL OR e.valid_to > substr(w.start_at,1,10))
), participation AS (
  SELECT r.tenant_id, r.program_id, r.sender_id AS employee_id, 'send' AS direction
  FROM v_official_recognition r CROSS JOIN windows w
  JOIN eligible e ON e.tenant_id=r.tenant_id AND e.program_id=r.program_id
    AND e.employee_id=r.sender_id AND e.can_send=1
    AND substr(r.activity_at,1,10)>=e.valid_from
    AND (e.valid_to IS NULL OR substr(r.activity_at,1,10)<e.valid_to)
  WHERE r.activity_at>=w.start_at AND r.activity_at<w.end_at
  UNION ALL
  SELECT r.tenant_id, r.program_id, rr.employee_id, 'receive'
  FROM v_official_recognition r JOIN recognition_recipients rr USING(tenant_id,recognition_id)
  CROSS JOIN windows w JOIN eligible e ON e.tenant_id=r.tenant_id AND e.program_id=r.program_id
    AND e.employee_id=rr.employee_id AND e.can_receive=1
    AND substr(r.activity_at,1,10)>=e.valid_from
    AND (e.valid_to IS NULL OR substr(r.activity_at,1,10)<e.valid_to)
  WHERE r.activity_at>=w.start_at AND r.activity_at<w.end_at
), populations AS (
  SELECT program_id, employee_id, 'send' AS direction FROM eligible WHERE can_send=1
  UNION SELECT program_id, employee_id, 'receive' FROM eligible WHERE can_receive=1
), scopes AS (
  SELECT program_id AS scope, program_id, employee_id, direction FROM populations
  UNION ALL SELECT 'ALL', program_id, employee_id, direction FROM populations
)
SELECT s.scope, s.direction, COUNT(DISTINCT s.employee_id) AS eligible_employees,
       COUNT(DISTINCT p.employee_id) AS participating_employees,
       ROUND(100.0*COUNT(DISTINCT p.employee_id)/COUNT(DISTINCT s.employee_id),2) AS participation_pct
FROM scopes s LEFT JOIN participation p
  ON p.program_id=s.program_id AND p.employee_id=s.employee_id AND p.direction=s.direction
GROUP BY s.scope,s.direction ORDER BY s.scope,s.direction;

-- R4: organization leaderboard, sent vs received independently, historical org,
-- normalized to eligible employees, suppress groups below the fixture threshold of 5.
-- Production access: owner/admin grants only; this example uses peer, October.
WITH period AS (
  SELECT '2026-10-01' AS start_on, '2026-11-01' AS end_on
), population AS (
  SELECT DISTINCT h.org_id,e.employee_id,'send' AS direction
  FROM eligibility e JOIN employee_history h USING(tenant_id,employee_id) CROSS JOIN period p
  WHERE e.tenant_id='meridian' AND e.program_id='peer' AND e.can_send=1
    AND max(e.valid_from,h.valid_from,p.start_on)<min(COALESCE(e.valid_to,'9999-12-31'),COALESCE(h.valid_to,'9999-12-31'),p.end_on)
  UNION
  SELECT DISTINCT h.org_id,e.employee_id,'receive'
  FROM eligibility e JOIN employee_history h USING(tenant_id,employee_id) CROSS JOIN period p
  WHERE e.tenant_id='meridian' AND e.program_id='peer' AND e.can_receive=1
    AND max(e.valid_from,h.valid_from,p.start_on)<min(COALESCE(e.valid_to,'9999-12-31'),COALESCE(h.valid_to,'9999-12-31'),p.end_on)
), participants AS (
  SELECT r.tenant_id,r.recognition_id,r.sender_id AS employee_id,'send' AS direction,r.activity_at
  FROM v_official_recognition r WHERE tenant_id='meridian' AND program_id='peer'
  UNION ALL
  SELECT r.tenant_id,r.recognition_id,rr.employee_id,'receive',r.activity_at
  FROM v_official_recognition r JOIN recognition_recipients rr USING(tenant_id,recognition_id)
  WHERE r.tenant_id='meridian' AND r.program_id='peer'
), org_events AS (
  SELECT h.org_id,p.* FROM participants p JOIN employee_history h
    ON h.tenant_id=p.tenant_id AND h.employee_id=p.employee_id
    AND substr(p.activity_at,1,10)>=h.valid_from
    AND (h.valid_to IS NULL OR substr(p.activity_at,1,10)<h.valid_to)
  CROSS JOIN period w
  WHERE substr(p.activity_at,1,10)>=w.start_on AND substr(p.activity_at,1,10)<w.end_on
), group_sizes AS (
  SELECT org_id,direction,COUNT(DISTINCT employee_id) AS eligible FROM population GROUP BY org_id,direction
), activity AS (
  SELECT org_id,direction,COUNT(DISTINCT recognition_id) AS events,
         COUNT(DISTINCT employee_id) AS participants FROM org_events GROUP BY org_id,direction
)
SELECT g.org_id,g.direction,g.eligible,COALESCE(a.events,0) AS recognition_events,
       ROUND(1.0*COALESCE(a.events,0)/g.eligible,2) AS events_per_eligible_employee,
       ROUND(100.0*COALESCE(a.participants,0)/g.eligible,2) AS participation_pct
FROM group_sizes g LEFT JOIN activity a USING(org_id,direction)
WHERE g.eligible >= CAST((SELECT value FROM dataset_metadata WHERE key='small_population_threshold') AS INTEGER)
ORDER BY direction,events_per_eligible_employee DESC;

-- Historical organization/customer attribute drill-through: transfer changes org at event time.
SELECT r.recognition_id,r.sender_id,r.activity_at,h.org_id,
       json_extract(h.attributes_json,'$.cost_center') AS cost_center
FROM v_official_recognition r JOIN employee_history h
  ON h.tenant_id=r.tenant_id AND h.employee_id=r.sender_id
  AND substr(r.activity_at,1,10)>=h.valid_from
  AND (h.valid_to IS NULL OR substr(r.activity_at,1,10)<h.valid_to)
WHERE r.tenant_id='meridian' AND r.recognition_id IN ('r-before-transfer','r-after-transfer')
ORDER BY r.activity_at;

-- M1: cumulative upcoming 30/60/90-day horizons: 1,2,3.
SELECT h.days,COUNT(m.entitlement_id) AS upcoming_entitlements
FROM (SELECT 30 AS days UNION ALL SELECT 60 UNION ALL SELECT 90) h
LEFT JOIN v_milestone_state m ON m.tenant_id='harbor' AND m.entitlement_state='upcoming'
 AND m.eligible_on <= date((SELECT value FROM dataset_metadata WHERE key='data_as_of'),'+'||h.days||' days')
GROUP BY h.days ORDER BY h.days;

-- M1: overview. Redemption performance = redeemed / all eligible, expired included.
SELECT entitlement_state,COUNT(*) AS entitlements FROM v_milestone_state
WHERE tenant_id='harbor' GROUP BY entitlement_state;
SELECT ROUND(100.0*SUM(entitlement_state='redeemed')/SUM(entitlement_state<>'upcoming'),2) AS redeemed_pct
FROM v_milestone_state WHERE tenant_id='harbor';

-- M2: 5 non-responders; notification failure is separately identifiable.
SELECT entitlement_id,employee_id,milestone_type,outstanding_age_days,aging_bucket,
       notification_status,expires_on,award_value_minor
FROM v_milestone_nonresponders WHERE tenant_id='harbor' ORDER BY outstanding_age_days DESC;

-- P1: shared wallet, never grouped by program. Point-in-time balances are additive ledgers.
SELECT * FROM v_employee_balances WHERE tenant_id='summit' ORDER BY balance_points DESC LIMIT 8;
SELECT SUM(points_delta) AS e09_balance_as_of_september_end FROM employee_points_ledger
WHERE tenant_id='summit' AND employee_id='e09' AND occurred_at<'2026-10-01T00:00:00Z';

-- O1: 10 orders, 14 item units, 2 redemption sources. Gross redemption excludes refunds.
SELECT redemption_source,COUNT(*) AS orders,SUM(item_units) AS item_units,
       COUNT(DISTINCT employee_id) AS redeemers,SUM(points_spent) AS gross_points_redeemed,
       SUM(value_minor) AS order_value_minor
FROM v_order_activity WHERE tenant_id='summit' GROUP BY redemption_source;

-- O2: aging and explicit exceptions; partial order shipped 2 of its 5 units.
SELECT o.order_id,o.redemption_source,o.status,o.item_units,
       CAST(julianday((SELECT value FROM dataset_metadata WHERE key='data_as_of'))-julianday(o.submitted_at) AS INTEGER) AS age_days,
       (SELECT SUM(si.quantity) FROM shipment_items si WHERE si.tenant_id=o.tenant_id AND si.order_id=o.order_id) AS shipped_units
FROM v_order_activity o WHERE o.tenant_id='summit'
  AND o.status IN ('processing','partially_shipped','failed','canceled') ORDER BY age_days DESC;

-- B1 bank-first: shared bank occurs once, even though it funds two programs.
SELECT b.*,ROUND(100.0*b.approved_award_points/NULLIF(b.opening_points+b.top_up_points+b.adjustment_points,0),2) AS utilization_pct
FROM v_bank_balances b WHERE tenant_id='atlas';
-- Program-first: actual awards by bank; no invented program-specific remaining balance.
SELECT r.program_id,rr.bank_id,SUM(rr.points) AS approved_points
FROM v_official_recognition r JOIN recognition_recipients rr USING(tenant_id,recognition_id)
WHERE r.tenant_id='atlas' AND rr.points>0 GROUP BY r.program_id,rr.bank_id;
SELECT * FROM v_pending_commitments WHERE tenant_id='atlas';

-- I1: pending has approved manager step but no final approval; approved may be unissued.
SELECT r.recognition_id,r.status,r.current_stage,r.responsible_approver_id,r.issued_at,
       a.stage,a.action,a.actor_id,a.occurred_at,a.reason
FROM recognitions r JOIN approval_events a USING(tenant_id,recognition_id)
WHERE r.tenant_id='atlas' AND r.recognition_id IN ('r-pending','r-rejected','r-approved-unissued')
ORDER BY r.recognition_id,a.occurred_at;

-- F1: ONLY Cedar has the extension. Values are supplied platform outputs, in USD minor units.
SELECT f.employee_id,a.recognition_id,r.program_id,f.allocated_points,
       f.funding_cost_minor,f.liability_released_minor,f.taxable_value_minor,f.source_calculation_id
FROM platform_financial_allocations f
JOIN employee_points_ledger a ON a.tenant_id=f.tenant_id AND a.transaction_id=f.award_transaction_id
JOIN recognitions r ON r.tenant_id=a.tenant_id AND r.recognition_id=a.recognition_id
WHERE f.tenant_id='cedar';

-- S3/S5: mocked asynchronous lifecycle and delivery fixtures (no email is actually sent).
SELECT tenant_id,export_id,status,data_as_of,row_count,expires_at,failure_reason
FROM export_jobs WHERE tenant_id='cedar' ORDER BY export_id;
-- S6/S7: equivalent report surfaces reconcile; export ROW count differs for multi-recipient events.
SELECT tenant_id,surface,approved_event_count,data_as_of,definition_version
FROM report_runs WHERE tenant_id='meridian';
-- S2/S8: expected security behavior for the POC application to implement and exercise.
SELECT user_id,resource,requested_tenant_id,expected_decision,explanation
FROM access_cases WHERE tenant_id='cedar';

-- U1. Qualifying interactive logins and distinct employees for the UTC period. The view excludes one-time-use PAC.
SELECT tenant_id, COUNT(*) AS successful_logins, COUNT(DISTINCT employee_id) AS users_logged_in
FROM user_logins
WHERE occurred_at >= '2026-10-01' AND occurred_at < '2026-11-01'
GROUP BY tenant_id ORDER BY tenant_id;
