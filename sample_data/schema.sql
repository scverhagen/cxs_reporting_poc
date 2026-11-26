PRAGMA foreign_keys = ON;

CREATE TABLE dataset_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE tenants (
  tenant_id TEXT PRIMARY KEY, name TEXT NOT NULL, scenario TEXT NOT NULL,
  timezone TEXT NOT NULL, currency TEXT NOT NULL, fifo_enabled INTEGER NOT NULL
);
CREATE TABLE organizations (
  tenant_id TEXT NOT NULL, org_id TEXT NOT NULL, name TEXT NOT NULL, parent_org_id TEXT,
  PRIMARY KEY (tenant_id, org_id), FOREIGN KEY (tenant_id) REFERENCES tenants,
  FOREIGN KEY (tenant_id, parent_org_id) REFERENCES organizations(tenant_id, org_id)
);
CREATE TABLE employees (
  tenant_id TEXT NOT NULL, employee_id TEXT NOT NULL, display_name TEXT NOT NULL,
  email TEXT NOT NULL, hired_on TEXT NOT NULL, terminated_on TEXT,
  PRIMARY KEY (tenant_id, employee_id), FOREIGN KEY (tenant_id) REFERENCES tenants
);
-- One successful interactive authentication per source event ID.
CREATE TABLE authentication_events (
  login_method TEXT NOT NULL CHECK (login_method IN ('password', 'sso', 'one_time_pac')),
  tenant_id TEXT NOT NULL, login_id TEXT NOT NULL, employee_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, login_id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, employee_id)
);
CREATE INDEX authentication_events_by_date ON authentication_events(tenant_id, occurred_at, employee_id);
-- U1 uses this same event population for totals, trends, latest login and drill-throughs.
CREATE VIEW user_logins AS
SELECT tenant_id, login_id, employee_id, occurred_at FROM authentication_events
WHERE login_method <> 'one_time_pac';
-- All intervals are [valid_from, valid_to); NULL means no known end.
CREATE TABLE employee_history (
  tenant_id TEXT NOT NULL, history_id TEXT NOT NULL, employee_id TEXT NOT NULL,
  org_id TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, attributes_json TEXT NOT NULL,
  manager_id TEXT, CHECK (manager_id IS NULL OR manager_id <> employee_id),
  FOREIGN KEY (tenant_id, manager_id) REFERENCES employees(tenant_id, employee_id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY (tenant_id, history_id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, employee_id),
  FOREIGN KEY (tenant_id, org_id) REFERENCES organizations(tenant_id, org_id),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE TABLE programs (
  tenant_id TEXT NOT NULL, program_id TEXT NOT NULL, name TEXT NOT NULL,
  program_type TEXT NOT NULL CHECK (program_type IN ('recognition','milestone')),
  monetary INTEGER NOT NULL, PRIMARY KEY (tenant_id, program_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants
);
CREATE TABLE eligibility (
  tenant_id TEXT NOT NULL, eligibility_id TEXT NOT NULL, employee_id TEXT NOT NULL,
  program_id TEXT NOT NULL, can_send INTEGER NOT NULL, can_receive INTEGER NOT NULL,
  valid_from TEXT NOT NULL, valid_to TEXT, PRIMARY KEY (tenant_id, eligibility_id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, employee_id),
  FOREIGN KEY (tenant_id, program_id) REFERENCES programs(tenant_id, program_id),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE TABLE funding_banks (
  tenant_id TEXT NOT NULL, bank_id TEXT NOT NULL, name TEXT NOT NULL,
  PRIMARY KEY (tenant_id, bank_id), FOREIGN KEY (tenant_id) REFERENCES tenants
);
CREATE TABLE bank_programs (
  tenant_id TEXT NOT NULL, bank_id TEXT NOT NULL, program_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, bank_id, program_id),
  FOREIGN KEY (tenant_id, bank_id) REFERENCES funding_banks(tenant_id, bank_id),
  FOREIGN KEY (tenant_id, program_id) REFERENCES programs(tenant_id, program_id)
);
CREATE TABLE bank_users (
  tenant_id TEXT NOT NULL, bank_id TEXT NOT NULL, employee_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, bank_id, employee_id),
  FOREIGN KEY (tenant_id, bank_id) REFERENCES funding_banks(tenant_id, bank_id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, employee_id)
);
CREATE TABLE recognitions (
  tenant_id TEXT NOT NULL, recognition_id TEXT NOT NULL, program_id TEXT NOT NULL,
  sender_id TEXT NOT NULL, status TEXT NOT NULL
    CHECK (status IN ('submitted','pending','approved','rejected','canceled')),
  submitted_at TEXT NOT NULL, approved_at TEXT, issued_at TEXT, notified_at TEXT,
  is_private INTEGER NOT NULL, message TEXT, current_stage TEXT, responsible_approver_id TEXT,
  PRIMARY KEY (tenant_id, recognition_id),
  FOREIGN KEY (tenant_id, program_id) REFERENCES programs(tenant_id, program_id),
  FOREIGN KEY (tenant_id, sender_id) REFERENCES employees(tenant_id, employee_id),
  FOREIGN KEY (tenant_id, responsible_approver_id) REFERENCES employees(tenant_id, employee_id),
  CHECK (status <> 'approved' OR approved_at IS NOT NULL)
);
CREATE TABLE recognition_recipients (
  tenant_id TEXT NOT NULL, recognition_id TEXT NOT NULL, employee_id TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points >= 0), bank_id TEXT,
  PRIMARY KEY (tenant_id, recognition_id, employee_id),
  FOREIGN KEY (tenant_id, recognition_id) REFERENCES recognitions(tenant_id, recognition_id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, employee_id),
  FOREIGN KEY (tenant_id, bank_id) REFERENCES funding_banks(tenant_id, bank_id),
  CHECK (points = 0 OR bank_id IS NOT NULL)
);
CREATE TABLE recognition_components (
  tenant_id TEXT NOT NULL, recognition_id TEXT NOT NULL,
  component TEXT NOT NULL CHECK (component IN ('ecard','badge','points','message','certificate')),
  template_id TEXT, PRIMARY KEY (tenant_id, recognition_id, component),
  FOREIGN KEY (tenant_id, recognition_id) REFERENCES recognitions(tenant_id, recognition_id)
);
CREATE TABLE recognition_tags (
  tenant_id TEXT NOT NULL, recognition_id TEXT NOT NULL,
  tag_type TEXT NOT NULL CHECK (tag_type IN ('category','value')), label TEXT NOT NULL,
  PRIMARY KEY (tenant_id, recognition_id, tag_type, label),
  FOREIGN KEY (tenant_id, recognition_id) REFERENCES recognitions(tenant_id, recognition_id)
);
CREATE TABLE social_events (
  tenant_id TEXT NOT NULL, social_event_id TEXT NOT NULL, recognition_id TEXT NOT NULL,
  employee_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('like','comment')),
  occurred_at TEXT NOT NULL, comment_text TEXT,
  PRIMARY KEY (tenant_id, social_event_id),
  FOREIGN KEY (tenant_id, recognition_id) REFERENCES recognitions(tenant_id, recognition_id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, employee_id)
);
CREATE TABLE approval_events (
  tenant_id TEXT NOT NULL, approval_event_id TEXT NOT NULL, recognition_id TEXT NOT NULL,
  stage TEXT NOT NULL, action TEXT NOT NULL, actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL, reason TEXT, PRIMARY KEY (tenant_id, approval_event_id),
  FOREIGN KEY (tenant_id, recognition_id) REFERENCES recognitions(tenant_id, recognition_id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES employees(tenant_id, employee_id)
);
CREATE TABLE milestone_entitlements (
  tenant_id TEXT NOT NULL, entitlement_id TEXT NOT NULL, employee_id TEXT NOT NULL,
  program_id TEXT NOT NULL, milestone_type TEXT NOT NULL, milestone_date TEXT NOT NULL,
  eligible_on TEXT NOT NULL, notified_at TEXT, notification_status TEXT NOT NULL,
  expires_on TEXT, redeemed_at TEXT, award_value_minor INTEGER,
  funding_mode TEXT NOT NULL CHECK (funding_mode IN ('entitlement','employee_points')),
  required_points INTEGER, PRIMARY KEY (tenant_id, entitlement_id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, employee_id),
  FOREIGN KEY (tenant_id, program_id) REFERENCES programs(tenant_id, program_id)
);
CREATE TABLE milestone_events (
  tenant_id TEXT NOT NULL, milestone_event_id TEXT NOT NULL, entitlement_id TEXT NOT NULL,
  kind TEXT NOT NULL, occurred_at TEXT NOT NULL, detail TEXT,
  PRIMARY KEY (tenant_id, milestone_event_id),
  FOREIGN KEY (tenant_id, entitlement_id) REFERENCES milestone_entitlements(tenant_id, entitlement_id)
);
CREATE TABLE orders (
  tenant_id TEXT NOT NULL, order_id TEXT NOT NULL, employee_id TEXT NOT NULL,
  redemption_source TEXT NOT NULL CHECK (redemption_source IN ('points','milestone')),
  entitlement_id TEXT, submitted_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted','processing','partially_shipped','shipped','delivered','failed','canceled')),
  points_spent INTEGER NOT NULL CHECK (points_spent >= 0), value_minor INTEGER,
  fulfillment_cost_minor INTEGER, shipping_address TEXT, internal_notes TEXT,
  PRIMARY KEY (tenant_id, order_id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, employee_id),
  FOREIGN KEY (tenant_id, entitlement_id) REFERENCES milestone_entitlements(tenant_id, entitlement_id),
  CHECK ((redemption_source = 'milestone' AND entitlement_id IS NOT NULL)
    OR (redemption_source = 'points' AND entitlement_id IS NULL))
);
CREATE TABLE order_items (
  tenant_id TEXT NOT NULL, order_id TEXT NOT NULL, item_id TEXT NOT NULL, sku TEXT NOT NULL,
  description TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_value_minor INTEGER NOT NULL, PRIMARY KEY (tenant_id, order_id, item_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, order_id)
);
CREATE TABLE order_events (
  tenant_id TEXT NOT NULL, order_event_id TEXT NOT NULL, order_id TEXT NOT NULL,
  status TEXT NOT NULL, occurred_at TEXT NOT NULL, exception_code TEXT, detail TEXT,
  PRIMARY KEY (tenant_id, order_event_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, order_id)
);
CREATE TABLE shipments (
  tenant_id TEXT NOT NULL, shipment_id TEXT NOT NULL, order_id TEXT NOT NULL,
  carrier TEXT NOT NULL, tracking_reference TEXT NOT NULL, shipped_at TEXT NOT NULL,
  delivered_at TEXT, PRIMARY KEY (tenant_id, shipment_id),
  UNIQUE (tenant_id, shipment_id, order_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, order_id)
);
CREATE TABLE shipment_items (
  tenant_id TEXT NOT NULL, shipment_id TEXT NOT NULL, order_id TEXT NOT NULL,
  item_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (tenant_id, shipment_id, item_id),
  FOREIGN KEY (tenant_id, shipment_id, order_id) REFERENCES shipments(tenant_id, shipment_id, order_id),
  FOREIGN KEY (tenant_id, order_id, item_id) REFERENCES order_items(tenant_id, order_id, item_id)
);
CREATE TABLE employee_points_ledger (
  tenant_id TEXT NOT NULL, transaction_id TEXT NOT NULL, employee_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opening','award','redemption','refund','adjustment','expiry','award_reversal')),
  points_delta INTEGER NOT NULL, occurred_at TEXT NOT NULL, recognition_id TEXT, order_id TEXT,
  reason TEXT, PRIMARY KEY (tenant_id, transaction_id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, employee_id),
  FOREIGN KEY (tenant_id, recognition_id) REFERENCES recognitions(tenant_id, recognition_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, order_id)
);
CREATE TABLE bank_ledger (
  tenant_id TEXT NOT NULL, transaction_id TEXT NOT NULL, bank_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opening','top_up','award','adjustment','reversal')),
  points_delta INTEGER NOT NULL, occurred_at TEXT NOT NULL, recognition_id TEXT,
  recipient_id TEXT, reason TEXT, PRIMARY KEY (tenant_id, transaction_id),
  FOREIGN KEY (tenant_id, bank_id) REFERENCES funding_banks(tenant_id, bank_id),
  FOREIGN KEY (tenant_id, recognition_id) REFERENCES recognitions(tenant_id, recognition_id),
  FOREIGN KEY (tenant_id, recipient_id) REFERENCES employees(tenant_id, employee_id)
);
-- Source-calculated specialized values; never recompute FIFO/tax in the POC.
CREATE TABLE platform_financial_allocations (
  tenant_id TEXT NOT NULL, allocation_id TEXT NOT NULL, employee_id TEXT NOT NULL,
  award_transaction_id TEXT NOT NULL, redemption_transaction_id TEXT NOT NULL,
  allocated_points INTEGER NOT NULL, funding_cost_minor INTEGER NOT NULL,
  liability_released_minor INTEGER NOT NULL, taxable_value_minor INTEGER NOT NULL,
  tax_jurisdiction TEXT NOT NULL, source_calculation_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, allocation_id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, employee_id),
  FOREIGN KEY (tenant_id, award_transaction_id) REFERENCES employee_points_ledger(tenant_id, transaction_id),
  FOREIGN KEY (tenant_id, redemption_transaction_id) REFERENCES employee_points_ledger(tenant_id, transaction_id)
);
CREATE TABLE report_catalog (report_id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_only INTEGER NOT NULL);
CREATE TABLE reporting_users (
  tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, employee_id TEXT NOT NULL, role TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, employee_id)
);
-- Self-only grants follow the reporting user’s employee identity. Other grants use program/org scope.
CREATE TABLE report_grants (
  tenant_id TEXT NOT NULL, grant_id TEXT NOT NULL, user_id TEXT NOT NULL, report_id TEXT NOT NULL,
  program_id TEXT, org_id TEXT, include_descendants INTEGER NOT NULL,
  self_only INTEGER NOT NULL DEFAULT 0 CHECK (self_only IN (0,1)),
  PRIMARY KEY (tenant_id, grant_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES reporting_users(tenant_id, user_id),
  FOREIGN KEY (report_id) REFERENCES report_catalog,
  FOREIGN KEY (tenant_id, program_id) REFERENCES programs(tenant_id, program_id),
  FOREIGN KEY (tenant_id, org_id) REFERENCES organizations(tenant_id, org_id)
);
CREATE TABLE field_grants (
  tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, field_name TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, field_name),
  FOREIGN KEY (tenant_id, user_id) REFERENCES reporting_users(tenant_id, user_id)
);
CREATE TABLE saved_views (
  tenant_id TEXT NOT NULL, view_id TEXT NOT NULL, user_id TEXT NOT NULL, report_id TEXT NOT NULL,
  name TEXT NOT NULL, filters_json TEXT NOT NULL, columns_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id, view_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES reporting_users(tenant_id, user_id),
  FOREIGN KEY (report_id) REFERENCES report_catalog
);
CREATE TABLE report_schedules (
  tenant_id TEXT NOT NULL, schedule_id TEXT NOT NULL, view_id TEXT NOT NULL,
  cron_expression TEXT NOT NULL, timezone TEXT NOT NULL, recipient_user_id TEXT NOT NULL,
  enabled INTEGER NOT NULL, next_run_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, schedule_id),
  FOREIGN KEY (tenant_id, view_id) REFERENCES saved_views(tenant_id, view_id),
  FOREIGN KEY (tenant_id, recipient_user_id) REFERENCES reporting_users(tenant_id, user_id)
);
CREATE TABLE export_jobs (
  tenant_id TEXT NOT NULL, export_id TEXT NOT NULL, user_id TEXT NOT NULL, report_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','expired')),
  requested_at TEXT NOT NULL, completed_at TEXT, data_as_of TEXT NOT NULL,
  filters_json TEXT NOT NULL, columns_json TEXT NOT NULL, row_count INTEGER,
  expires_at TEXT, download_link_placeholder TEXT, failure_reason TEXT,
  PRIMARY KEY (tenant_id, export_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES reporting_users(tenant_id, user_id),
  FOREIGN KEY (report_id) REFERENCES report_catalog
);
CREATE TABLE delivery_events (
  tenant_id TEXT NOT NULL, delivery_id TEXT NOT NULL, export_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, occurred_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, delivery_id),
  FOREIGN KEY (tenant_id, export_id) REFERENCES export_jobs(tenant_id, export_id),
  FOREIGN KEY (tenant_id, recipient_user_id) REFERENCES reporting_users(tenant_id, user_id)
);
CREATE TABLE access_cases (
  tenant_id TEXT NOT NULL, case_id TEXT NOT NULL, user_id TEXT NOT NULL,
  resource TEXT NOT NULL, requested_tenant_id TEXT NOT NULL, expected_decision TEXT NOT NULL,
  explanation TEXT NOT NULL, PRIMARY KEY (tenant_id, case_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES reporting_users(tenant_id, user_id),
  FOREIGN KEY (requested_tenant_id) REFERENCES tenants
);
CREATE TABLE report_runs (
  tenant_id TEXT NOT NULL, run_id TEXT NOT NULL, report_id TEXT NOT NULL, surface TEXT NOT NULL,
  filters_json TEXT NOT NULL, data_as_of TEXT NOT NULL, definition_version TEXT NOT NULL,
  approved_event_count INTEGER NOT NULL, PRIMARY KEY (tenant_id, run_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants, FOREIGN KEY (report_id) REFERENCES report_catalog
);

CREATE INDEX recognition_period ON recognitions(tenant_id, approved_at, program_id);
CREATE INDEX eligibility_window ON eligibility(tenant_id, program_id, valid_from, valid_to);
CREATE INDEX employee_points_history ON employee_points_ledger(tenant_id, employee_id, occurred_at);
CREATE INDEX bank_points_history ON bank_ledger(tenant_id, bank_id, occurred_at);
CREATE INDEX milestone_eligibility ON milestone_entitlements(tenant_id, eligible_on, redeemed_at);

-- Shared reporting definitions use the fixed snapshot recorded in metadata.
CREATE VIEW v_official_recognition AS
SELECT r.tenant_id, r.recognition_id, r.program_id, r.sender_id,
       r.submitted_at, r.approved_at AS activity_at, r.issued_at, r.notified_at, r.is_private,
       CASE WHEN r.is_private = 1 THEN NULL ELSE r.message END AS message,
       COALESCE(a.points_awarded, 0) AS points_awarded, COALESCE(a.recipient_count, 0) AS recipient_count
FROM recognitions r
LEFT JOIN (
  SELECT tenant_id, recognition_id, SUM(points) AS points_awarded, COUNT(*) AS recipient_count
  FROM recognition_recipients GROUP BY tenant_id, recognition_id
) a USING (tenant_id, recognition_id)
WHERE r.status = 'approved'
  AND r.approved_at <= (SELECT value FROM dataset_metadata WHERE key = 'data_as_of');

CREATE VIEW v_employee_balances AS
SELECT e.tenant_id, e.employee_id, COALESCE(SUM(l.points_delta), 0) AS balance_points,
       COALESCE(SUM(CASE WHEN l.kind = 'award' THEN l.points_delta ELSE 0 END), 0) AS earned_points,
       COALESCE(SUM(CASE WHEN l.kind = 'redemption' THEN -l.points_delta ELSE 0 END), 0) AS redeemed_points,
       COALESCE(SUM(CASE WHEN l.kind = 'expiry' THEN -l.points_delta ELSE 0 END), 0) AS expired_points,
       COALESCE(SUM(CASE WHEN l.kind IN ('adjustment','award_reversal','refund') THEN l.points_delta ELSE 0 END), 0) AS adjusted_points,
       MAX(CASE WHEN l.kind = 'redemption' THEN l.occurred_at END) AS last_redemption_at,
       MAX(l.occurred_at) AS last_activity_at
FROM employees e LEFT JOIN employee_points_ledger l
  ON l.tenant_id = e.tenant_id AND l.employee_id = e.employee_id
 AND l.occurred_at <= (SELECT value FROM dataset_metadata WHERE key = 'data_as_of')
GROUP BY e.tenant_id, e.employee_id;

CREATE VIEW v_bank_balances AS
SELECT b.tenant_id, b.bank_id,
       COALESCE(SUM(CASE WHEN l.kind = 'opening' THEN l.points_delta ELSE 0 END), 0) AS opening_points,
       COALESCE(SUM(CASE WHEN l.kind = 'top_up' THEN l.points_delta ELSE 0 END), 0) AS top_up_points,
       COALESCE(SUM(CASE WHEN l.kind = 'award' THEN -l.points_delta ELSE 0 END), 0) AS approved_award_points,
       COALESCE(SUM(CASE WHEN l.kind IN ('adjustment','reversal') THEN l.points_delta ELSE 0 END), 0) AS adjustment_points,
       COALESCE(SUM(l.points_delta), 0) AS remaining_points
FROM funding_banks b LEFT JOIN bank_ledger l
  ON l.tenant_id = b.tenant_id AND l.bank_id = b.bank_id
 AND l.occurred_at <= (SELECT value FROM dataset_metadata WHERE key = 'data_as_of')
GROUP BY b.tenant_id, b.bank_id;

CREATE VIEW v_pending_commitments AS
SELECT r.tenant_id, r.program_id, rr.bank_id, SUM(rr.points) AS potential_points
FROM recognitions r JOIN recognition_recipients rr USING (tenant_id, recognition_id)
WHERE r.status IN ('submitted','pending') AND rr.points > 0
GROUP BY r.tenant_id, r.program_id, rr.bank_id;

CREATE VIEW v_milestone_state AS
SELECT m.*,
       CASE WHEN m.eligible_on > substr(s.value, 1, 10) THEN 'upcoming'
            WHEN m.redeemed_at IS NOT NULL AND m.redeemed_at <= s.value THEN 'redeemed'
            WHEN m.expires_on IS NOT NULL AND m.expires_on <= substr(s.value, 1, 10) THEN 'expired'
            ELSE 'outstanding' END AS entitlement_state,
       CAST(julianday(substr(s.value, 1, 10)) - julianday(m.eligible_on) AS INTEGER) AS outstanding_age_days,
       CASE WHEN m.eligible_on > substr(s.value, 1, 10) THEN NULL
            WHEN julianday(substr(s.value, 1, 10)) - julianday(m.eligible_on) < 30 THEN '0-29'
            WHEN julianday(substr(s.value, 1, 10)) - julianday(m.eligible_on) < 60 THEN '30-59'
            WHEN julianday(substr(s.value, 1, 10)) - julianday(m.eligible_on) < 90 THEN '60-89'
            ELSE '90+' END AS aging_bucket
FROM milestone_entitlements m CROSS JOIN dataset_metadata s WHERE s.key = 'data_as_of';

CREATE VIEW v_milestone_nonresponders AS
SELECT * FROM v_milestone_state WHERE entitlement_state = 'outstanding';

CREATE VIEW v_order_activity AS
SELECT o.tenant_id, o.order_id, o.employee_id, o.redemption_source, o.entitlement_id,
       o.submitted_at, o.status, o.points_spent, o.value_minor, o.fulfillment_cost_minor,
       COALESCE(i.item_units, 0) AS item_units,
       (SELECT MIN(occurred_at) FROM order_events e WHERE e.tenant_id=o.tenant_id AND e.order_id=o.order_id AND e.status='processing') AS processing_at,
       (SELECT MIN(shipped_at) FROM shipments s WHERE s.tenant_id=o.tenant_id AND s.order_id=o.order_id) AS first_shipped_at,
       CASE WHEN o.status='delivered' THEN (SELECT MAX(delivered_at) FROM shipments s WHERE s.tenant_id=o.tenant_id AND s.order_id=o.order_id) END AS delivered_at
FROM orders o LEFT JOIN (
  SELECT tenant_id, order_id, SUM(quantity) AS item_units FROM order_items GROUP BY tenant_id, order_id
) i USING (tenant_id, order_id)
WHERE o.submitted_at <= (SELECT value FROM dataset_metadata WHERE key='data_as_of');

-- Views are semantic conveniences, NOT a SQLite row/column security boundary.
-- Authorization and additional field permissions must be applied by the POC service.
