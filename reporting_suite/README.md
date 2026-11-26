# CXS Recognize reporting POC

From the project root, run `python3 reporting_suite/app.py` and open http://127.0.0.1:8765. Pass `--port` to choose another port. The Python server opens the sample database read-only and serves the React frontend from `build/`. CSV generation uses Node.js and the installed frontend dependencies. For a fresh checkout, follow the [initial setup](../README.md#run-locally) to generate the database, install dependencies and build both bundles.

The demo opens on the Meridian Labs overview for October 2026. Select a reporting period and organization, then click any chart or key number to open the corresponding report with those filters. Returning to Overview restores its selection. Recognition uses approval dates, orders use submission dates and milestone counts use eligibility dates. Wallet trends show closing balances and carry earlier transactions into the opening balance. Use the customer selector to switch datasets. Date, program, and organization filters apply to the recognition activity, category, and participation reports. Changing customer preserves the reporting period and clears customer-specific filters.

Select **Compare to → Previous period** on Overview to see the previous value and absolute change for each key number. Participation changes use percentage points. Daily trend charts align both periods by elapsed day. The solid line shows the current period and the dashed line shows the previous period. Participation and award charts mark the previous value on each current bar. Opening a report preserves the overlay. Chart CSV tables include both series with their actual dates or category labels. An unmatched day has an empty cell. Full months compare with the preceding calendar month, month-to-date compares the same days of the preceding month, and custom dates use the immediately preceding equal-length window. Year-to-date compares the same dates last year. A comparison outside the sample history is marked unavailable. Drill-through reports, saved views, schedules and CSVs retain this selection. Compared recipient exports label each row with its period.

To pick both windows, set **Reporting period** to **Custom dates** and enter **From** and **Through**. Set **Compare to** to **Custom dates** and enter **Comparison from** and **Comparison through**. Both ranges are inclusive and may overlap, have different lengths, or appear in either order. Saved views, schedules, drill-throughs and CSVs retain both selections. In a recipient export, an event in both periods appears once per recipient in each labeled period.

**Last 7 days**, **Last 30 days** and **Last 90 days** include the UTC day the report runs. Saved views and schedules store the preset. Each delivery resolves it again and includes the resulting dates in the CSV. **Previous period** follows the rolling window by the same number of days, while a custom comparison retains its chosen dates. The fixtures are a fixed November 10 snapshot, so later runs move the dates without creating new transactions.

On Overview, choose **Break down by** to split each chart using a customer employee attribute. For Harbor Health, choose **Clinical service** and open **Outpatient** on a chart to see the underlying report for that service and both selected periods. Saved views and schedules retain the breakdown. The CSV identifies the group on each series row. **Reset filters** in the filter panel restores the defaults for the active overview or report.

Viewers with access to **Funding budgets** see remaining points, award spending and utilization for each funding bank. The **Budget balance over time** chart shows the daily closing points balance for each bank. Enable a comparison to overlay the two periods, then select a bank’s chart to inspect the same series in Funding budgets. Overview and funding CSVs include bank names, IDs, UTC dates and closing balances for both periods. Organization and employee filters apply to the sender’s award spending. Each bank’s remaining balance and utilization cover the entire bank, including banks shared by multiple programs.

**Organization breakdown** compares visible divisions in adjacent columns. Select **North Division** to compare **Engineering** and **Operations**, or select a value to open its source report for that unit. Use the breadcrumb above the table to return to a division or the full visible scope. The same organization selection applies to the overview, saved views, schedules and CSV exports. Employee filters and both date ranges carry through each drill.

Open **Managerial hierarchy** in the sidebar, or select a person under **Team breakdown** on Overview. A manager’s page lists direct reports and team measures. Select a row to open the next team or employee page. **View individual report** opens the manager’s own records. Use **Up one level**, the breadcrumb, or browser Back and Forward to navigate. In Harbor Health’s manager role, follow Drew Demo Harbor → Jules Demo Harbor → Indigo Demo Harbor. Saved views, scheduled deliveries and CSVs retain the report page and comparison. **Reset filters** keeps the current page.

In **Recognition activity**, open a manager under **Recognition activity by team**. The **Direct reports** table compares approved events by the sender’s reporting line on the approval date. Select a team to see its counts, trend and event ledger, or select an employee to see their own sends. Use **Up one level** or the breadcrumb to return. The report retains the program, organization, employee attributes, category or value, and both date ranges. Search and component selections carry over in the ledger. Saved views, schedules and CSVs retain the team or individual page.

In **Categories & values**, open a manager and switch between **Categories** and **Values** above the direct reports table. Each column shows how many approved recognitions carried that label. With a comparison enabled, labels from either period appear. Select a team or person to open their breakdown, or a chart label to open their matching Recognition activity. The breadcrumb and **Up one level** keep the filters and date comparison. Team CSVs include both categories and values.

In **Program performance**, choose a program, then open a manager to compare approved recognitions, sending participation, receiving reach, events per active sender and points across their direct reports. Select a name for the same measures, trend and mix on that team’s or employee’s page. **Up one level** and the breadcrumb preserve the program, filters and date comparison. Saved views and scheduled CSVs retain the page. In the sample datasets the Admin role has the Program performance grant.

In **Recognition leaderboards**, use **Rank by** to choose sent or received recognition. Open a manager to compare their direct reports by approved events per eligible employee. Select a team and compare its summary with the parent row. **Up one level** and the breadcrumb preserve the ranking direction, filters and comparison. A team appears when at least one period meets the minimum of five eligible people in the sample data. Each period and direction is checked separately, including in saved views and scheduled CSVs. The sample Admin role has the leaderboard grant.

In **Participation**, select a manager under **Participation by team** to compare their direct reports. Each row shows sending and receiving rates and the active and eligible populations behind them. With a date comparison enabled, the row also shows the comparison rate, population and change in percentage points. Select a row to open its Participation page, or use the breadcrumb or **Up one level** to return with the same filters and comparison.

On Overview, select **Logins over time** or any of the three login counts to open **User logins** with the same customer, role, organization, employee filters and date comparison. The **Users without a login** card opens the list of employees behind the current count, with comparison-period logins alongside each name. **Show all login activity** returns to the full report with the same filters. Selecting a group on the trend opens that group’s login report.

Open **User activity → User logins** for successful sign-ins, distinct people, employees without a sign-in, and a daily trend. Open a team or employee to inspect their results for either window. Latest login is limited to the selected period. Successful one-time-use PAC logins are excluded from all login metrics, trends, employee history and exports. PAC-only employees are excluded from the reporting population, including the no-login list and team drill-downs. A mixed-method employee with only PAC activity in the selected period contributes to neither group for that period. Employees with no authentication history can still appear on the no-login list. Login events in this POC are synthetic.

In **Approval history**, select a manager to compare the status of requests submitted by each direct report and their team. Open a name to inspect the requests for either submission window, then select a request ID to see its approval steps. **Up one level** and the breadcrumb keep the status, search, program, organization, employee attributes and comparison. Saved views and scheduled CSVs retain the same page. The sample Admin role has the I1 grant.

Open **Employee attributes** to combine customer-specific and common filters. Recognition activity uses the sender’s assignment at approval. Participation uses each sender’s or recipient’s assignment and eligibility. Orders use submission, milestones use eligibility (or the snapshot for future awards), and wallets use the balance date. Funding filters apply to attributed spending while bank balances cover the whole bank. Attributes come from role-visible assignment history. Sender attributes are available in recognition detail, configurable table columns and recipient CSVs.

Activity uses final approval time in UTC. Search and component controls narrow the detail table. Select an approval date to inspect the event and its recipients, components, timestamps, and engagement. Categories and values can overlap. Select a label to open its activity timeline and details.

Activity and category filters use the sender's organization on the approval date. Participation uses the sender's or recipient's own organization for each direction. Eligible employees must have overlapping program eligibility and organizational membership during the selected period. Participants must also qualify on the event date. Combined rates count distinct employees across programs.

Select a customer and **Demo role** in the sidebar. The role persists across customer changes and page reloads in the browser session. The account name and its reporting scope appear below the switcher.

| Demo role | Visible reports and data |
| --- | --- |
| Admin | Customer-wide reports enabled by the fixture, including taxable benefits at Cedar Global. |
| Manager | North Division user logins, recognition activity, categories, participation and milestones. Activity follows the sender’s assignment on the approval date and includes the recipients named on those events. Participation scopes senders and recipients independently. Milestones use the assignment at eligibility, or the snapshot date for future eligibility. Recognition message text is hidden. |
| Employee | The selected employee’s own logins, points, orders and milestones. Each fixture uses employee `e09`, who has a delivered points order and no milestone entitlements at the snapshot date. |

The demo switcher provides local impersonation. The server resolves grants and filters source data for the active role before returning a report. Saved views, schedules, exports, delivery emails and links belong to one customer and one reporting user. A schedule uses its creator’s current permissions even when someone is viewing the suite under another role. Only admins can see monetary order totals and unit prices. Employees can see the quantity and points spent on their own orders.

Milestone reports use the dataset snapshot date. Awards overview counts entitlements in each lifecycle state and divides redemptions by all awards that have reached eligibility, including expired awards. Select a horizon or aging bucket to open its employee list. Upcoming milestones supports 30, 60, 90 days and all future dates. Non-responders includes outstanding awards with failed notifications. Redeemed awards leave the list immediately, including those awaiting shipment.

Milestone program, type, and organization filters apply to all three milestone reports. Organization uses the employee's assignment at eligibility for past awards and the snapshot assignment for upcoming awards. The customer selector retains the report and its horizon or aging window while refreshing customer-specific filters. Harbor Health's November 10, 2026 snapshot has four upcoming, five outstanding, three redeemed, and one expired entitlement.


### Customer appearance

In the sidebar, choose **Appearance** to use Light, Dark or the system setting. The browser remembers this choice across customers and roles. As an admin, open **Brand colors**, choose a primary and secondary color, then select **Save colors**. The pair is stored for that customer and applies to all three demo roles. The suite adjusts accent brightness for readability in each mode.

### Full curated catalog

The workspace includes the overview, a managerial hierarchy report, and the 13 curated report families. Participation is a dedicated view, and milestone overview and upcoming eligibility have separate pages. All reports are accessible from the sidebar and report finder when enabled for the selected customer.

| Customer | Report to try | Expected result |
| --- | --- | --- |
| Meridian Labs | Program performance and recognition leaderboards | October 2026 has 19 approved events, 850 points and 5 of 24 eligible senders participating. Department ranking suppresses groups below five eligible employees. |
| Summit Retail | Employee points, order activity and fulfillment exceptions | Ten submitted orders cover 14 units. The partial order contains five units and its shipment contains two. Wallet transaction history includes awards, debits and refunds. |
| Atlas Industrial | Funding budgets and approval history | The 625 potential commitment points have no bank debit. Search for `r-pending` to see the manager's approval and the outstanding director stage. |
| Cedar Global | Taxable benefits | Two platform allocations account for 120 points, $0.98 funding cost, $1.09 liability released and $1.32 taxable benefit. The related order costs are counted once. |

Program performance and leaderboards default to October for comparison with the recognition activity report. Operational reports start with the full sample period. Wallets use a balance date. Order and approval filters use submission dates, and current status reflects the snapshot. Fulfillment exceptions initially flag open orders aged seven days or more in addition to recorded exceptions, failures and cancellations. This threshold is adjustable.

Funding balances and utilization cover whole banks. Program and sender filters scope the spending breakdown. The bank opening column includes prior postings and opening entries during the period. Potential commitments come from the current request snapshot. Financial allocations require both the enabled tenant feature and the administrator's report and field grants. Changing away from Cedar while viewing taxable benefits returns to recognition activity.

### Saved views, scheduled reports and exports

Use the three actions below the Overview or report title. On Overview, each action captures the selected period, custom dates, and organization. The overview CSV includes the visible summary numbers and the data behind each authorized chart. **Saved views** stores the current report, filters, searches, category drill-down and table column selections. **Schedules** captures its own copy of those settings for daily or weekly delivery at a chosen UTC time. Use **Run now** to try a delivery immediately. Pausing preserves the schedule.

**Exports** generates a CSV in the background and shows progress in the customer's delivery inbox. Report CSVs include summary measures and all rows of the selected tables. Recognition activity also offers a recipient-level CSV with stable IDs, recipient points, timestamps, tags and permitted messages. Count distinct recognition IDs to reconcile event totals. All five fixtures use USD, and points retain their own unit.

The local demo delivers an email with a download link to the selected persona’s inbox. The envelope button downloads the original email. Set `REPORTING_SMTP_PORT` to a local SMTP capture server's port to receive the same message there. Each customer and role has its own fictional delivery address. Links expire after 24 hours, and downloading rechecks the customer, report and field grants. The server processes schedules while running and makes one catch-up delivery after downtime. The sample data watermark stays fixed independently of the delivery clock.

Workspace changes persist in `var/workspaces.sqlite` separately from the generated fixtures. Set `REPORTING_STATE_DB` to use another workspace database.

### Frontend development

The frontend uses React, Vite, Tailwind CSS and shadcn/ui's New York registry components. Editable application source lives in `src/`, registry components in `src/components/ui/`, and theme tokens in `src/theme.css`. Report-specific charts use the existing fixture definitions. The SQLite API remains in `app.py`.

From `reporting_suite/`, run `npm ci` and `npm run build` to update the frontend served by Python. For hot reload, start the Python server on its default port and run `npm run dev` in another terminal. Vite proxies `/api` to the local Python server.
