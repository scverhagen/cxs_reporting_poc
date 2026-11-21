# CXS Recognize — Reporting Modernization Requirements

**Draft v1 · Discovery synthesis November 9, 2026 · Updated November 20, 2026**

## 1. Purpose and problem

CXS Recognize needs a consistent, configurable reporting experience for recognition program owners, administrators, and other authorized stakeholders. Existing reporting has historically produced **conflicting counts, quantities, and totals across reports or systems**. This has undermined confidence in the data and created avoidable reconciliation and maintenance work.

**Recommended foundation:** adopt a governed **metrics and semantic layer** (or an equivalently strong centralized capability) that defines business measures and dimensions once and makes them reusable across dashboards, curated reports, investigation views, and exports. This is a best-practice architectural pattern particularly well suited to a suite of related reports with complex eligibility, program, funding, and permission rules. It will materially reduce definition-driven inconsistencies, though source-data errors, refresh timing, and permission differences still need explicit controls.

**Product outcome:** Equivalent metrics must reconcile when evaluated for the same tenant, population, status rules, time range, filters, and data-as-of point. When results intentionally differ, users and support teams must be able to identify why.

This document describes product behavior and business rules. It does not select a vendor, API framework, physical schema, or frontend technology.

## 2. Product principles

1. **Trustworthy and explainable:** common measures use consistent definitions; totals reconcile across experiences.
2. **Recognition events, not components:** an e-card, value badge, points, message, and certificate can coexist in **one** recognition. Component usage must not inflate event counts.
3. **Eligibility-aware:** sending and receiving participation use the appropriate program-eligible populations, including historical changes.
4. **Approvals matter:** only approved recognition contributes to official recognition activity. Pending, rejected, or canceled requests are exposed through operational investigation.
5. **Distinct lifecycles:** recognition, milestone entitlements, employee points, funding point banks, redemptions, and order fulfillment must remain distinguishable even when linked.
6. **Permissioned by default:** data visibility depends on reporting role, organization, program, and field restrictions. Program eligibility can inform reporting scope but is not itself sufficient authorization.
7. **Consistent interaction:** organizational drill-down, customer-specific attributes, configurable filters and columns, saved views, and scheduling behave consistently.
8. **Detailed data when needed:** raw dataset exports are richer than curated reports while preserving privacy and authorization.

## 3. Audiences

| Audience | Primary needs | Visibility principle |
| --- | --- | --- |
| Program owner | Program performance, values, milestone pipeline, budgets, points, rewards, owner-only leaderboards | Configured program and organizational scope |
| Platform/customer administrator | Cross-program oversight, customer login activity and transaction investigations | Explicit administrative reporting permissions |
| Customer service/fulfillment | Find recognition or order status and resolve exceptions | Operational scope; sensitive fields separately authorized |
| Approver | Work requiring their decision | Primarily an operational workflow, not a reporting dashboard |
| Manager or individual contributor | Normal recognition experience and explicitly granted team or personal login history | **No recognition leaderboards** by default; no implied access to owner reports |

The POC covers Meridian Labs, Harbor Health, Summit Retail, Atlas Industrial and Cedar Global using synthetic data. Each supports three test roles. The admin has customer-wide access to granted reports. The manager has North Division access to recognition activity, categories, participation, milestones and logins. The employee has personal access to points, orders, milestones and logins. Customer-specific attributes and enabled reports follow the selected customer. Monetary amounts in all five datasets use US dollars. Points retain their own unit.

## 4. Prioritization from discovery

This table records **relative customer priorities**, not a committed release schedule. Foundational capabilities support every wave.

| Area | Relative priority / decision |
| --- | --- |
| Recognition Activity and Timeline, Categories and Values, Participation | Highest-demand reporting area; first implementation slice |
| Upcoming Milestones | Next-highest operational report; slightly ahead of non-responders |
| Milestone Non-Responders | High priority; deliver with Upcoming Milestones **and a basic Milestone Awards Overview** |
| Reward Order Activity and order-level status | Ahead of employee points balances; program owners need transaction drill-down |
| Employee Points Balance | Ahead of approval reporting |
| Recognition Leaderboards | Ahead of approval reporting; available only to program owners/authorized administrators |
| Recognition Program Performance | Ahead of approval reporting; consolidated view with program drill-down; may reuse the first slice's measures early |
| Point Bank and Program Budget Utilization | Explicitly required; final ranking against the other areas remains open |
| Recognition Approval History and Investigation | Low priority for analytics; retain essential investigative search and history |
| Advanced correlation, predictions, AI executive narratives | Later enhancements; do not imply causal impact from recognition activity alone |

## 5. Curated reporting catalog

### Overview

The overview summarizes the selected customer using the viewer’s report and field grants. Each measure reconciles with its source report for the same population, dates and data snapshot.

| Source | Information included when authorized |
| --- | --- |
| User logins | Successful sign-ins, distinct users who signed in, users without a login and daily sign-in counts. The no-login count identifies the employees behind it. |
| Recognition and participation | Approved recognition volume over time, points awarded and sending and receiving participation by program, using each direction’s eligible population. |
| Milestones | Awards reaching eligibility during the period and their status at the snapshot, including upcoming, outstanding, redeemed and expired awards as applicable. |
| Points and orders | Closing employee points balances over time, order volume by submission date and item quantities. Monetary order value requires administrator access to orders. |
| Funding budgets | Remaining points, attributed award spending, utilization and the daily closing balance for each funding bank. Program and sender selections scope attributed spending. Balances and utilization describe the whole bank. |

A measure or trend leads to the underlying report with the same customer, role, applicable filters and both date windows. When results are grouped by an authorized employee attribute, the underlying detail retains that group, including an unassigned value where applicable. For a comparison, include each period’s measures, their signed changes and both sets of trend values. Organization and managerial breakdowns are defined in section 6.

### U1. User Logins

Login reporting requires an explicit U1 grant. Use the successful interactive authentication event ID and UTC timestamp from the customer’s authentication source. Password and SSO sign-ins qualify when the source records them. Exclude failed attempts, token refreshes and passive session activity. Login measures apply across recognition programs.

| Measure | Definition within one observed reporting period |
| --- | --- |
| Successful logins | Count distinct successful sign-in events. Repeat sign-ins by one employee contribute separate events. Daily totals use the UTC sign-in date. |
| Users logged in | Count distinct employees with at least one qualifying sign-in in scope. Attribute each event to the employee’s authorized organization, team and attributes at sign-in. |
| Users without a login | Start with distinct employees whose authorized assignment overlaps the observed portion of the period. Count those with zero qualifying sign-ins in that scope. |
| Employee login history | For each employee in scope, include login count and latest successful sign-in within each selected period. Individual and personal detail includes the actual sign-in times. |

Within each observed period, users who signed in plus users without a login must equal the distinct assigned population in scope. Calculate this population independently for each period.

**Employees behind the no-login count.** Return one record per matching employee with name, employee ID and current-period login count. The number of records must equal the overview count, including when it is zero. With a comparison enabled, include the comparison-period login count and latest successful sign-in in UTC for those same employees. An employee who signed in during the comparison period still qualifies if they had zero current-period sign-ins. An employee in scope only during the comparison period is excluded. Distinguish zero observed sign-ins from unavailable data or an out-of-scope assignment.

The overview, full login report, employee list, saved views and deliveries use the same customer and role permissions. An administrator may have customer-wide access, a manager access to assigned organizations, and an employee self-only access. The full report and no-login detail retain the applicable organization, employee attributes, team or individual scope, dates and comparison when moving between them. A saved or scheduled employee list retains its selection rule and recalculates membership for the effective dates and current grants.

### R1. Recognition Activity and Timeline

**Purpose:** inspect approved recognition activity and associated social engagement.

- Scope activity to a team or individual and filter by date, program, customer-defined employee attributes, category and value. Detail search supports sender and recipient, with recognition components available in the ledger and recipient extract.
- Show approved recognition count, distinct senders/recipients, points awarded, and trends. Include likes and comments where captured.
- Detail rows include recognition identifier, sender/recipient, relevant event timestamps, program, components, category/value, points, and message if permitted.
- Recognitions can have any combination of non-monetary and monetary components, including e-cards, badges, points, message, and certificate. Certificate presence or template can be recorded without reporting certificate body text.
- A private recognition remains countable; its message is blanked/suppressed under the established warehouse privacy rule. Exact existing behavior is **to be verified**.
- Pending and rejected submissions do not contribute to official activity measures.

#### Participation

Report sending and receiving participation separately. For each direction and period, the denominator is the distinct employees whose program eligibility and in-scope assignment overlap. The numerator is the distinct eligible employees who sent or received an approved recognition while eligible and in scope at approval. Include both counts with the rate. Compute each period independently, express rate changes in percentage points and identify rates with no eligible denominator as unavailable.

### R2. Recognition Categories and Values

- Show activity by configurable recognition category and organizational value; support time trends and organizational comparison.
- A single event associated with multiple attributes must not be double-counted in the overall event total. Component/category breakdown totals may be non-additive and must be labeled accordingly.
- Allow drill-through to authorized recognition details.

### R3. Recognition Program Performance

- A **consolidated overview** of the recognition programs the viewer is authorized to manage, with drill-down into one program.
- Answer: Is the program used effectively? Which values/behaviors are reinforced? Where does participation need attention?
- Include approval-qualified volume, eligible sending/receiving participation, reach, frequency, component mix, values/categories, and trends.
- Show points awarded and budget metrics for applicable programs; do not rate non-monetary programs negatively because they have no spending.
- Allow program comparison with appropriate eligibility normalization. Recalculate unique populations when aggregating programs; do not add percentages.
- Future: narrative insights and correlations with independently supplied engagement/retention outcomes, with no causal claims absent suitable evidence.

### R4. Recognition Leaderboards

- Access requires a program-owner or authorized administrator leaderboard grant.
- Rank individuals and groups/departments by sent versus received recognition separately, with configurable periods and comparisons.
- Provide absolute measures and normalized measures such as recognitions per eligible employee and participation percentage; explain differences in eligible group sizes.
- Compare a manager’s immediate direct reports by approved events per eligible employee. Each branch includes the direct report and their visible descendants. Count each event once per branch, using the sender’s or recipients’ eligible assignments at UTC approval for the selected direction. Equal scores share a rank. Show event, eligible and active counts alongside frequency and participation.
- Apply the configured minimum eligible population after the program, organization, employee attributes and team scope are applied. Evaluate each period and direction independently. Suppress the rank, counts, rates and trend values for an undersized population. Show a change only when both readings are reportable. Include a branch in results and detail only when at least one period qualifies. Include qualifying groups with zero activity.
- Individual rankings, individual detail and saved selections require a population meeting the same minimum. Apply the same rules to department breakdowns, exports and scheduled deliveries.

### M1. Milestone Awards Overview and Upcoming Milestones

- Milestone types include service anniversaries, retirement, and other configured milestones, using the same lifecycle.
- Deliver a basic **Milestone Awards Overview** alongside both curated milestone reports, showing upcoming counts, outstanding entitlements, redemption performance, aging, and optional upcoming expirations.
- Upcoming Milestones report: identify employees approaching eligibility over configurable horizons (e.g., 30/60/90 days), milestone type, date, program, and relevant employee attributes.
- In CXS Recognize, becoming eligible normally triggers notification; report notification delivery exceptions separately if events are available.

### M2. Milestone Award Non-Responders and Activity

- Non-responder means an eligible/notified milestone award entitlement that remains **unredeemed**. It is not an order already redeemed but awaiting fulfillment.
- Include employee, milestone type, eligibility date, outstanding age, award value if applicable, current redemption status, and expiration date only if configured.
- Support aging buckets, milestone-type filtering, hierarchy drill-down, saved views, and scheduling.
- Milestone Award Activity tracks eligibility, outstanding entitlements, and completed redemptions.
- Milestone entitlements are **normally distinct** from the employee's shared recognition points balance; uncommon points-funded milestone awards are accommodated without redefining the normal case.

### P1. Employee Points Balance and Activity

- One **shared points bank per employee** receives awards from multiple recognition programs.
- Show current/as-of points balance, earned, redeemed, adjusted and expired where applicable, last redemption/activity, large balances, and trends when history supports them.
- Show points *awarded by program*, but do not attribute the **remaining shared balance** to a program by default.
- Authorized employee-level balances and group distributions are subject to field/organizational permissions.
- Exceptional FIFO and taxable-benefit reporting is handled separately using values **already calculated by the platform**; do not burden ordinary balance measures with FIFO allocation logic.

### O1. Order Activity and Timeline

- Points redemptions and milestone entitlement redemptions share one underlying order/fulfillment system. Provide one report with a **redemption-source** filter.
- Show order counts, item quantities, distinct redeemers, status, and trends over configurable date ranges. Count orders separately from units.
- Only administrators with access to the underlying report may see monetary order values, including unit prices, individual order totals, and aggregates. Apply this field rule to queries, dashboards, order details, saved views, scheduled deliveries, and exports. Employees and managers can still see points spent and item quantities within their authorized scope.
- Permit program owners to drill down to authorized order details including items, submitted/processing/shipped/delivered dates, tracking where captured, and exceptions.
- Restrict shipping addresses, internal notes, and other sensitive data independently of ordinary order-status visibility.

### O2. Fulfillment Exceptions and Performance

- Investigate delayed, failed, canceled, or aging orders; show current status and event chronology where available.
- Advanced exception dashboards, service levels, and proactive alerts are later enhancements; initial order-status investigation is in scope.
- Redemption activity (what was purchased) and fulfillment (whether it arrived) remain separately measurable.

### B1. Point Bank and Program Budget Utilization

- Customers create **funding point banks**, assign multiple users to them, and users can select the funding bank for recognition. A bank can be associated with multiple recognition programs; program restrictions may apply.
- Funding point banks are distinct from recipient employees' shared points balances.
- **Bank-first view:** opening balance, funding/top-ups, approved awards funded, adjustments/reversals, remaining balance, utilization, trends, and spending by authorized sender/program.
- **Program-first view:** points awarded through a program broken down by funding bank, sender, time, and authorized organizational dimensions.
- The approved recognition transaction must support attribution to the actual funding bank and program. Do not assign an entire shared bank's remaining balance to each program it funds, or double-count across programs.
- Pending requests, if displayed, are **potential commitments** separate from actual issued/approved utilization.

### I1. Recognition Status, Approval History, and Investigation

- Low-priority operational report, not a high-priority approval analytics dashboard.
- Find requests by ID, sender, recipient, program, date, or status; display submitted/pending/approved/rejected/canceled states as supported.
- Show current approval stage, responsible approver where authorized, full chronological approval steps, actor, timestamp, and recorded reasons/comments.
- On a manager’s page, compare total requests and counts for each supported status across immediate direct reports. Include each direct report and their descendants under the sender’s reporting line at UTC submission. Count each request once in each applicable period, regardless of recipients, approval steps or subsequent issuance. Classify by status at the data snapshot.
- Compare the current submission window with a previous or custom window. Show signed changes, including zero counts for assigned teams with no matching requests. Identify comparisons outside available history as unavailable. Open a team or individual to inspect matching requests and their approval steps in either available period.
- **Full approval history already exists** in CXS Recognize. Investigators need a concise answer to “Where is this recognition?”
- Recognize that issuance/notification can be separate from approval when diagnosing an exception; do not conflate reward order fulfillment with recognition approval.

### F1. Financial and Taxable-Benefit Reports

- Distinguish points funding/awards, employee points liabilities, redemptions, and fulfillment costs; do not presume their accounting values are interchangeable.
- Provide specialized FIFO/taxable-benefit output only to customers using that functionality. Reuse platform-calculated allocations and taxable values, with employee, award, program, and transaction context, rather than recalculating tax treatment in generic reports.
- Financial export and reconciliation requirements may warrant additional restricted columns and permissions.

## 6. Shared reporting capabilities

| ID | Requirement |
| --- | --- |
| S1 | Support organization, program and customer-specific employee attributes as applicable, including multi-program selection where supported. Users can choose report fields, compare organizational units and move between a manager, direct reports and individual records. |
| S2 | Report visibility is configurable by role, organization, program, and sensitive field; eligibility may further scope views but does not alone authorize access. |
| S3 | Users can save, schedule, and export reports and the overview dashboard. Preserve the selected reporting period, comparison, organization, manager or individual report location, and authorized employee attributes across drill-throughs and deliveries. Resolve last-7-, last-30-, and last-90-day presets for each delivery, including its UTC run date, and show the effective dates in exports. Keep each configuration and delivery within its customer and owner. |
| S4 | Raw data downloads expose **richer detailed datasets** than curated reports using the same filtering/security concepts. Recognition messages may be included except where private-message rules suppress them. |
| S5 | Raw exports are **asynchronous**; users request an export and receive an email with a **secure download link** when it is ready. Provide status/history, access checks, and expiration. |
| S6 | Curated reports, dashboards, detailed drill-down, and exports use consistent business metric definitions, status rules, and period boundaries. |
| S7 | Outputs indicate effective reporting filters and, where relevant, data-as-of time and measure definition so discrepancies can be investigated. |
| S8 | Multi-tenant isolation and personal-data privacy must apply at query, detail, and export levels, including scheduled outputs. Every overview measure and trend inherits its source report’s permissions. Recheck current access when generating an output and before serving a download. |

### Reporting periods and delivery

- Fixed reporting and comparison windows use inclusive UTC dates. A custom comparison can overlap the reporting window, have a different duration or occur later. Include actual dates for both series. For daily comparisons, match by elapsed day and identify days with no counterpart.
- A full calendar month compares with the preceding month. Month-to-date compares through the corresponding day of the preceding month, year-to-date with the corresponding prior-year interval, and a custom or rolling window with the immediately preceding equal-length interval unless a custom comparison is supplied.
- Last 7, 30 and 90 days include the UTC run date. Each scheduled run resolves the preset again. A custom comparison retains its explicit dates. Report data availability through the source snapshot and distinguish unavailable values from observed zeros.
- Saved views and daily or weekly UTC schedules retain the report or overview, applicable filters, employee attributes, selected detail, fields and comparison. A schedule can be paused or run on demand. Report CSVs include authorized summary measures and all matching detail records for the selected fields. Recognition activity also supports a recipient-level extract with stable recognition IDs, recipient points, timestamps, tags and permitted message content.

### Organization, team and individual detail

Employee filters support shared attributes such as employment type and customer-defined attributes such as Harbor Health’s Clinical service. Apply each attribute against the authorized assignment in effect on the date used by the measure.

**Organization scope.** Compare visible peer units within the selected organization, including divisions and their departments. A unit includes its authorized descendants. Use each source report’s assignment date to attribute recognition, participation, logins, milestones, orders, wallet balances and funding spend. Keep shared bank balances at the bank level. For each applicable measure, provide current and comparison values and signed change, using percentage points for rates. Organization exports identify the unit, metric and effective periods.

**Managerial scope.** The hierarchy starts with the highest teams and employees visible to the viewer. It supports moving from a manager to an immediate direct report, through successive teams to an individual, and back to a parent or previously visited scope. A team includes the named employee and authorized descendants. An individual scope includes that employee’s own records. A manager’s own individual results are available where the report grant and population rules allow them. Managerial relationships are independent of organizational-unit filters.

Build each hierarchy from authorized, effective-dated assignments. A transfer can place a person in different branches in different periods. Recalculate distinct populations and rates at each level. A reporting relationship confers no additional report, field or organizational access. A personal grant exposes only the employee’s own branch.

| Report | Detail and reconciliation rules |
| --- | --- |
| User logins | Each direct report’s branch includes successful sign-ins, distinct users and users without a login. Individual scope includes authorized sign-in times. Overview connects to the full login report or the current-period no-login list defined in U1. |
| Recognition activity | Compare approved events sent by each direct report and their team. Assign each event once to the sender’s branch at UTC approval. Include assigned branches with zero events. The team totals, trend and event ledger use the same scope. Sender detail uses the reporting path at approval. Search and component selections narrow the ledger and recipient extract. |
| Categories and values | Compare total approved events and counts for each distinct category or value attached to an event in the sender’s branch at approval. Include labels from either period. Authorized recognition detail retains the branch and selected label. Exports include both categories and values. |
| Participation | For each direct report’s branch, include distinct active and eligible senders and recipients, the two participation rates, and their changes. Team and individual results use the definitions in R1. |
| Program performance | For the selected program or all programs, compare approved events, sending participation, receiving reach, events per active sender and points. Attribute sends and points to the sender’s branch at approval. Include incoming recognition in the eligible recipient’s branch. The team’s program comparison, trend and component, category and value mix use the same scope and R3 grant. |
| Recognition leaderboards | Compare direct reports under the selected sent or received measure. A branch’s totals reconcile with its parent’s result, and its own direct reports are ranked within that branch. Department scope and individual rankings remain available under the R4 grant and its period- and direction-specific suppression rules. |
| Approval history | Compare total requests and counts by snapshot status using the sender’s assignment at submission. Team and individual request histories retain program, status and search. Include each available period’s matching requests and authorized chronological approval details. Comparison exports include both request ledgers. |
| Milestones | Eligibility horizons and outstanding-age groups identify the matching employees and their entitlement records. Use the employee assignment at eligibility, or at the snapshot for future eligibility. |
| Points, orders and fulfillment | Employee balance detail includes the ledger at the balance date. Order and exception detail includes items and status history, scoped at submission. |
| Funding budgets | A bank’s balance history leads to the same bank and both periods in funding detail. Employee and organization scope apply to attributed spending at posting. |
| Financial allocations | Scope allocations by the employee’s assignment at redemption and enforce the source report’s field restrictions. |

Reporting context follows the result into detail and back. Preserve the customer, role, organization, employee attributes, manager-to-employee path, team or individual scope, applicable report selections and date comparison. Returning to the overview restores its original scope. Resetting ordinary filters retains the team or individual report location. Saved views and schedules retain this context, and exports identify the effective path, scope and dates.

## 7. Acceptance criteria (cross-cutting)

The named employees, dates and expected counts below refer to the synthetic POC datasets.

1. **Reconcilability:** For equivalent authorized filters, reporting period, recognition status, population, and data-as-of point, a dashboard, curated report, and detailed export produce the same approved recognition count. Any differing aggregation or refresh semantics are documented and visible.
2. **No component inflation:** One approved recognition containing a badge, e-card, points, message, and certificate counts as one recognition event; each included component can still be reported.
3. **Approval boundary:** A submitted but pending/rejected recognition appears in investigation but not official recognition activity. Once approved, official activity reflects it according to the agreed effective-date rule.
4. **Eligibility denominator:** Sending and receiving participation use the proper eligible population for the selected program and historical period, not the entire tenant by default.
5. **Private message:** A private event remains available for authorized aggregate counts while its message is blank/suppressed in every accessible detail/export surface, subject to confirmation of the platform's exact existing rule.
6. **Milestone distinction:** An eligible but unredeemed milestone entitlement appears as a non-responder; a redeemed award delayed in shipping does not.
7. **Shared wallet:** Program A and Program B awards increase a common employee balance; reports show awards by source program but never invent a program-specific remainder.
8. **Bank/program many-to-many:** A point bank funding multiple programs is not counted as multiple funding balances in aggregate; each approved points award is attributed to its actual bank and program.
9. **Unified orders:** Both points and milestone redemption orders appear in the order timeline and can be filtered by origin, while counts remain unique at the order grain.
10. **Restricted reporting:** An employee or ordinary manager cannot access the owner-only leaderboard; only authorized administrators see order values, including per-item prices and totals in underlying data, drill-downs, and exports. Points fields follow their separate grants.
11. **Asynchronous export:** Request returns without a long-running page wait; a secure link is delivered after completion; subsequent access still respects the configured safeguards.
12. **Financial extension:** Standard points metrics work without FIFO; authorized specialized reports use the platform's existing FIFO/taxable results and reconcile with source records.
13. **Managerial hierarchy.** A manager’s scope identifies each immediate direct report and its branch. A direct report’s team totals reconcile with the parent’s result. The manager’s individual detail isolates their own records. Returning to the parent or reopening a saved team view preserves the authorized path, comparison and filters.
14. **Historical transfers.** Records for a person who changes managers belong to the applicable branch at the event date defined by the source report. Detail, saved views, scheduled runs and CSVs reproduce that assignment. A saved path to an inaccessible person yields no access.
15. **Organization comparison.** In Harbor Health’s October 2026 admin overview, North and South have 14 and 1 approved recognitions respectively. North includes Operations (13) and Engineering (1). Each department’s figures reconcile with its report and CSV under employee filters and custom dates. Returning to North restores its peer comparison. A North-scoped manager can compare the authorized departments in North.
16. **Participation.** In Harbor Health across all programs, compare October 16–31, 2026 with October 1–15. On Drew’s team, Jules’s branch has receiving participation of 1 of 8 (12.5%) versus 8 of 9 (88.9%), a change of −76.4 percentage points. Jules’s team detail must reproduce both populations and rates, including each employee’s dated assignment.
17. **Recognition activity.** For the same customer, programs and periods, Alex’s branch under Drew sent 2 versus 9 approved recognitions (change −7). Jules’s branch sent 0 versus 1 (change −1). Finley’s pre-transfer recognition belongs to Jules’s comparison-period branch. The team totals, trends and authorized event detail must reconcile under the same program, organization, employee attributes and recognition label.
18. **Categories and values.** For the same periods, Customer impact accounts for 2 versus 5 events in Alex’s branch and 0 versus 1 in Jules’s branch. Ownership accounts for 0 versus 3 in Alex’s branch. The authorized Ownership detail in Recognition activity must return those same three comparison-period events. CSVs include both dimensions, observed zeros and comparison availability.
19. **Program performance.** For Everyday Thanks and the same periods, Alex’s branch has 1 versus 4 approved recognitions, sending participation of 14.3% versus 28.6%, and 50 versus 400 points. Jules’s branch has zero sends in both periods and receiving reach of 0% versus 44.4%. Each branch reconciles under R3 with the same program, dates and scope, including rolling periods and scheduled CSVs.
20. **Leaderboard suppression.** For Everyday Thanks and the same periods, Alex’s branch has 1 versus 4 sent events across 7 eligible senders in each period (frequencies of 0.14 versus 0.57). Its receiving population falls below the five-person minimum in both periods. Jules’s branch has 0 received events across 8 eligible recipients versus 5 across 9. With a test minimum of 9, only Jules’s comparison reading qualifies and the change is unavailable. The same rules apply to direct access, saved views and scheduled CSVs.
21. **Approval history.** In Harbor Health, compare Above and Beyond submissions on November 1–10, 2026 with October 1–10. Alex’s branch under Drew has 7 versus 2 requests. Approved counts are 3 versus 2. Submitted, pending, rejected and canceled each account for 1 versus 0. The distinct request IDs in each ledger must reconcile with those counts. Pending request `r-pending` includes its outstanding approval stage. Team scope, search, status, program, employee attributes and dates carry into detail and delivery under the I1 grant.
22. **Login visibility.** For Harbor Health in October 2026, the North manager’s authorized history includes the transferring employee’s October 15 sign-in and excludes sign-ins after the October 16 transfer. Employee e09’s personal history has 7 October sign-ins, most recently October 28 at 08:00 UTC. Downloaded and scheduled results obey the same scope.
23. **Overview login reconciliation.** In Harbor Health for October versus September 2026, the admin has 244 versus 234 successful sign-ins, 35 versus 34 distinct users and 5 versus 5 assigned employees without a login. The overview and U1 must agree on each measure and both daily series, including under a manager or personal grant, a custom comparison and a Clinical service grouping. Revoking U1 removes login measures and detail from the overview and subsequent deliveries.
24. **No-login membership.** The October Harbor Health admin result contains exactly e07, e14, e21, e28 and e35. The North manager’s result contains e07 and e14. Employee e09’s October result is empty. With October 1 as the reporting window and the full month as the comparison, e09’s personal result contains e09 with zero current sign-ins and seven comparison sign-ins. The list must reconcile with the current count after changes to organization, attributes, team or dates. Saved views and scheduled CSVs preserve the selection under current grants.

## 8. Open product/data validation decisions

- Confirm the production authentication source, event IDs, coverage of SSO providers and retained login history before reporting production adoption trends.
- Confirm precise date basis for approved recognition metrics (approval timestamp versus issuance timestamp), including reversals/cancellations after approval.
- Verify the warehouse's private-recognition blanking behavior and its scope across direct reports, detail records, full exports, and scheduled output.
- Confirm multiple-recipient recognition handling, cross-program distinct-employee denominators, and normalization conventions.
- Define employee eligibility history/effective dates and what happens when organizational attributes change retroactively.
- Define point-bank utilization periods, funding/top-ups, rollover, adjustments, and whether pending recognition creates reservations.
- Confirm available order item/status history, partial shipments, fulfillment time fields, and customer-visible tracking information.
- Set data freshness, retention, dataset size/export limits, secure-link expiration, and reconciliation tolerances.
- Finalize relative priority of Point Bank Utilization against other high-priority reports and the precise phase-one cut.
- Confirm approval statuses/reasons that are captured and allowed to be shown to each role.

## 9. Suggested delivery slices

1. **Trusted recognition foundation:** business definitions, reporting scope, Recognition Activity/Timeline, categories/values, and detailed export consistency.
2. **Milestone operations:** Upcoming Milestones, Non-Responders, and basic Milestone Awards Overview together.
3. **Reward operations:** unified order timeline and order-level investigation, followed by points balances.
4. **Program oversight:** owner-only leaderboards, recognition Program Performance with drill-down, and bank/program budget utilization (sequence to be validated).
5. **Investigations and enhancements:** approval history on demand, deeper fulfillment exceptions, advanced comparisons, and later AI/external-outcome analysis.
