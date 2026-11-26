# CXS Recognize reporting POC sample data

Five fictional customer datasets share one SQLite database, `reporting_poc.sqlite`.
The fixtures cover every curated report family in `../CXS_Recognize_Reporting_Requirements_v1.md`
and provide configuration/lifecycle records for the shared reporting capabilities.
No production data, working download tokens, or real delivery integrations are included.

**Reporting data watermark:** November 10, 2026, 16:00 UTC (10:00 a.m. Central).
Mock export operations occur after that source-data watermark. Activity spans January–November
2026; upcoming milestone fixtures extend into February 2027. Generation is deterministic.

## Five examples

| Tenant ID | Example | Employees / recognition requests | What to demonstrate |
| --- | --- | --- | --- |
| `meridian` | **Meridian Labs: Are employees participating, and which values are reinforced?** | 24 / 146 | R1–R4. Three overlapping programs, including a non-monetary program; multi-component and multi-recipient recognition; private messages; social activity; eligible senders versus receivers; an October hire, termination, and organization transfer. |
| `harbor` | **Harbor Health: Who has an upcoming milestone, and who has not redeemed?** | 40 / 102 | M1–M2. Service, retirement, and certification milestones; 30/60/90-day pipeline; four aging buckets; delivery failure; optional expiration; outstanding versus redeemed versus expired; a redeemed award stuck in fulfillment. |
| `summit` | **Summit Retail: What happened to employee points and reward orders?** | 60 / 234 | P1, O1–O2. Shared wallets funded by multiple recognition programs; large balances; expiry, adjustment, refund, and as-of history; points and milestone orders in one timeline; multiple quantities, partial shipment, failed/canceled/delayed orders; one uncommon points-funded milestone. |
| `atlas` | **Atlas Industrial: Where did the funding go, and where is this recognition?** | 32 / 124 | B1, I1, R3. One bank funds two programs; one program uses two banks; multiple bank users; top-up, corrections, unused reserve, actual award attribution; 625 points in potential commitments; multi-stage approvals and approved-but-unissued recognition. |
| `cedar` | **Cedar Global: Can authorized users export and reconcile restricted information?** | 36 / 168 | F1, S1–S8. USD financial outputs, platform-supplied allocation/tax values, role/program/org/field grants, owner-only leaderboards, cross-tenant denial cases, saved views, schedules, queued/running/completed/failed/expired exports, mock email delivery, and permission rechecks. |

Every tenant includes the common lifecycle fixtures so the same report can be exercised across
customers. Company size, recognition volume, eligibility populations, and financial
extension availability vary. Each has 13 milestone entitlements and 10 orders. These are
functional examples for a demo, not statistically representative usage or load-test data.

## Open and reproduce

Use any SQLite viewer, Python's built-in `sqlite3`, or the SQLite CLI. No packages are required.
From the repository root:

```sh
python3 sample_data/generate.py
python3 sample_data/verify.py
sqlite3 -header -column sample_data/reporting_poc.sqlite < sample_data/queries.sql
```

`generate.py --output /some/path/demo.sqlite` writes an alternate database and adjacent manifest.
Generate the database once after cloning. Subsequent runs replace the generated database and refresh the manifest.

| File | Purpose |
| --- | --- |
| `reporting_poc.sqlite` | Ready-to-query database containing all five tenants. |
| `reporting_poc.manifest.json` | Watermark, scenario descriptions, row counts, and known October results. |
| `schema.sql` | Tables, composite tenant foreign keys, indexes, and shared semantic views. |
| `generate.py` | Deterministic stdlib-only data builder. |
| `queries.sql` | Runnable examples for all thirteen report families, plus history, exports, and security fixtures. |
| `verify.py` | Fixture invariants and independent cross-lifecycle reconciliation checks. |

## Known answers for the first demo

October means **[2026-10-01 00:00 UTC, 2026-11-01 00:00 UTC)** with approval time as the date basis,
all programs and organizations included, and the fixed source watermark. These are tenant-wide
administrative totals; an owner with narrower scope should see different totals.

| Tenant | Approved recognition events | Points awarded | Recipient-grain export rows |
| --- | ---: | ---: | ---: |
| Meridian | 19 | 850 | 20 |
| Harbor | 15 | 725 | 16 |
| Summit | 27 | 1,225 | 28 |
| Atlas | 17 | 775 | 18 |
| Cedar | 21 | 925 | 22 |

- **`r-multi`:** one event, two recipients, five components, two categories, two values,
  250 total points. Category/value/component breakdowns overlap and are non-additive.
  A recipient-level raw export counts distinct event IDs to reconcile its event measure.
- **`r-private`:** countable recognition with a NULL message in `v_official_recognition`.
- **Approval boundaries:** `r-pending`, `r-submitted`, `r-rejected`, and `r-canceled` remain
  searchable in `recognitions`/`approval_events` but contribute no official activity or issued points.
  `r-boundary` was submitted in September, approved October 1, and issued October 2.
  `r-approved-unissued` is official November activity without issuance/notification timestamps.
- **Eligibility:** Meridian's October sending denominators are peer **16**, spot **8**,
  and care **24**; the combined distinct denominator is **24**, not 48.
  Peer receiving eligibility is **16**, despite a tenant headcount of 24.
  `e20` becomes eligible October 16; `e19` leaves after October 20.
  `e18` sends before and after an October 16 transfer, in different organizations.
- **Milestones:** every tenant has **1/2/3** upcoming entitlements within **30/60/90 days**,
  **5 outstanding**, **3 redeemed**, **1 expired**, and **4 upcoming** overall.
  The basic redeemed percentage is **3/9 = 33.33%** of entitlements that have become eligible.
  One outstanding entitlement has a failed notification; it is separately flagged.
  `m-redeemed-delayed` is not a non-responder even though its order is processing.
- **Orders:** each tenant has **10 orders / 14 units / 9 distinct redeemers**;
  **7 points-source orders / 11 units**, **3 milestone-source orders / 3 units**.
  `o-points-partial` has two line items totaling five units, with two units shipped.
  A points-funded milestone still has redemption source `milestone` and debits the shared wallet.
- **Funding:** the shared bank funds peer and spot; peer also uses the North bank.
  Three bank balance rows remain three rows regardless of the program bridge.
  Pending/submitted requests total **625 potential points** and do not debit either ledger.
- **Finance:** only Cedar has specialized allocation rows. The two source-provided records
  allocate **120 points** to a redemption, with **98** funding-cost, **109** liability-release,
  and **132** taxable-value minor currency units. These are separate measures, and none is
  the order's retail value. Opening balances represent legacy points outside this supplied
  specialized allocation extract. Do not infer a currency conversion or recalculate FIFO/tax.

## Data grains and relationships

All tenant-owned entity identities use `(tenant_id, entity_id)`; short IDs intentionally repeat
across tenants. Joins that omit `tenant_id` produce incorrect results and can disclose other tenants.

| Lifecycle | Tables / grain |
| --- | --- |
| People and history | `employees`: employee; `employee_history`: dated org/attribute interval; `organizations`: hierarchy node. Attributes include region, location, cost center, employment type, and job level. |
| Programs and eligibility | `programs`: configured program; `eligibility`: employee/program effective interval, with separate send and receive flags. |
| Recognition | `recognitions`: event; `recognition_recipients`: event/recipient points and actual bank; `recognition_components`: event/component; `recognition_tags`: event/category-or-value/label. |
| User logins | `authentication_events` records successful password, SSO and one-time-use PAC sign-ins by customer, source event ID, employee and UTC timestamp. The `user_logins` reporting view excludes PAC. In September and October, e07 has only PAC sign-ins and is excluded from login reporting, including no-login counts. Employee e09 has both SSO and PAC, and only the SSO events qualify. |
| Social and approval | `social_events`: individual like/comment; `approval_events`: chronological action/stage/actor. |
| Milestones | `milestone_entitlements`: employee entitlement; `milestone_events`: lifecycle transition. No ordinary entitlement credit goes into an employee wallet. |
| Orders | `orders`: redemption order, linked to entitlement when applicable; `order_items`: order line; `order_events`: status transition; `shipments` and `shipment_items`: shipment and shipped line quantity. |
| Employee points | `employee_points_ledger`: signed employee transaction, linked to recognition or order where applicable. No program-specific remaining-wallet column exists. |
| Funding | `funding_banks`: funding bank; `bank_programs`/`bank_users`: many-to-many assignments; `bank_ledger`: signed bank transaction. Recipient award credits reconcile to matching bank award debits. |
| Specialized finance | `platform_financial_allocations`: synthetic source-supplied allocation, linking award and redemption transactions with separately valued costs, liability, and taxable output. |
| Authorization | `reporting_users`, `report_grants`, `field_grants`: configured roles and explicit grants. `access_cases`: expected allow/deny/redact examples, including expired and revoked-access cases. |
| Delivery and reconciliation | `saved_views`, `report_schedules`, `export_jobs`, `delivery_events`, `report_runs`: configuration, asynchronous lifecycle, mocked delivery, and equivalent-surface metric snapshots. |

The eight shared views are `user_logins`, `v_official_recognition`, `v_employee_balances`, `v_bank_balances`,
`v_pending_commitments`, `v_milestone_state`, `v_milestone_nonresponders`, and `v_order_activity`.
Recognition and order views preaggregate children to preserve their parent grain.

## Explicit POC policies and open decisions

These choices make the sample reproducible; they do not resolve the source document's open decisions.

1. **Time:** UTC ISO-8601 timestamps, half-open report periods and effective intervals;
   official recognition uses final approval time. Tenant timezones are stored for future local-date
   conversion. The SQL examples intentionally use UTC. Awards credit wallets and debit funding
   at approval, even when issuance is delayed. Post-approval cancellation/reversal semantics remain
   unmodeled; the correction entries have no recognition status transition.
2. **Multi-recipient events:** one event overall, one recipient row per employee, points summed
   across recipients. Received leaderboards count distinct events per person/group. A multi-recipient
   event spanning groups could count once in each group, so group totals would be non-additive.
3. **Historical populations:** an employee enters a period denominator if eligible at any time in
   that period; a participant must be eligible at the event instant. This is not a person-day weighted
   rate. Organizational attributes come from event-time history. Historical corrections are not seeded.
4. **Privacy and permissions:** private messages always become NULL in the recognition reporting
   view, even for admins. Non-private messages still require a field grant in the application.
   Manager grants cover North Division recognition and milestones, including descendant organizations. Employee grants use the self_only flag to restrict milestone, wallet and order reports to the persona’s own employee ID. Missing grants deny access.
   Order visibility and shipping addresses are separately permissioned. Leaderboard groups below
   five eligible employees are omitted by the example query; complementary suppression and wider
   disclosure controls remain application decisions.
5. **Milestones:** future eligibility is upcoming; eligible/unredeemed/unexpired entitlements are
   outstanding non-responders, including notification exceptions. Expired entitlements are separate;
   they are included in the overview redemption denominator. Expiry occurs at the start of `expires_on`.
   Notification failure is reported separately from redemption status.
6. **Funding:** pending requests are potential commitments with no reservation ledger entries.
   Balances derive from signed transactions. The example utilization is gross approved awards divided
   by opening funding plus top-ups plus net corrections; rollover and period-specific funding policy
   remain open. Bank and wallet corrections are separate supplied transactions.
7. **Orders:** points debit on submission; failed/canceled examples receive full refunds. Gross
   redemption and net point consumption therefore differ. Fulfillment costs, retail value, and point
   amounts have no assumed conversion. Tracking references are fictional, without live carrier links.
8. **Exports:** completed, expired, and revoked fixtures have illustrative 24-hour expiration/access
   outcomes. The source watermark is independent of export processing time. Email/link strings are
   placeholders. `report_runs` records known October results; it is evidence for a demo, not three
   independently implemented report engines. Raw export row counts use recipient grain.

**SQLite does not enforce the reporting authorization model.** Composite foreign keys prevent invalid
cross-tenant relationships, not unauthorized reads. The POC service must enforce tenant, report,
program, organization, and field access for aggregates, details, exports, and scheduled output.
Base tables retain fictional private text and restricted fields for testing redaction. Do not expose
the database itself or unrestricted SQL to report viewers.

## Requirements coverage and validation limits

- **U1, R1–R4, M1–M2, P1, O1–O2, B1, I1, F1:** fixture tables, focused scenarios above, and runnable SQL.
- **S1:** hierarchy, effective employee attributes, multiprogram queries, configurable columns/filters.
- **S2 / S8:** tenant-composite relationships, org/program/report/field grants, repeated IDs across
  tenants, negative-access fixtures, and small-group suppression example. Runtime enforcement is future work.
- **S3:** saved configurations and an enabled weekly schedule with an explicit timezone.
- **S4:** richer export column metadata and recipient detail distinct from curated event grain.
- **S5:** asynchronous job states, history, expiry, placeholder links, mock delivery and revoked-access cases.
- **S6 / S7:** common semantic views, equivalent-surface snapshots, filters, data watermark, and definition version.
- **Acceptance criteria 1–9 and 12:** fixtures and data/metric reconciliations. **Criteria 10–11:** grant and
  lifecycle fixtures for later end-to-end UI/service tests; the generator does not implement security or delivery.

`verify.py` checks database integrity, composite foreign keys, non-overlapping history/eligibility,
valid participant eligibility, funding restrictions, historical nonnegative balances, award credits
versus actual bank debits, order/entitlement/ledger links, line values and shipment quantities,
known October and horizon counts, message suppression in the shared view, mock export chronology,
and specialized source totals. It also executes all example queries. These checks establish usable
sample data; they do not claim that UI, authorization, scheduling, emails, or secure downloads exist.

Future predictions, causal impact, AI executive narratives, advanced service-level dashboards,
retention/engagement outcomes, and production-scale performance are outside this initial fixture set,
consistent with the requirements' later-enhancement scope.

Each customer has a reporting field in employee assignment history: research group (Meridian), clinical service (Harbor), store format (Summit), production line (Atlas), or business unit (Cedar). The demo roles have explicit field grants for their customer’s attribute and the five common employee attributes. Employee e18 changes assignment and custom attribute on October 16. To introduce another field, populate its key in the dated employee history and grant `attribute:<key>` to the reporting users who may use it. The filter list and sender attribute columns read those grants.

Employee assignments also store the direct supervisor in `employee_history.manager_id`. Each customer has a senior manager, team leads and individual contributors. Employee e18 transfers from e10’s engineering team to e21’s service team on October 16, 2026. Employee e04 is the demo North manager and e09 is the personal-role employee.
