# CXS Recognize reporting POC

Explore recognition, participation, login activity, milestones, orders and budgets across five synthetic customers. The demo lets you switch roles, drill into teams, compare periods, and save, schedule or export reports.

## Run locally

Use Python 3 with SQLite support, npm, and Node.js 20.19 or later in the 20.x series, or Node.js 22.12 or later. From the repository root, run:

```sh
python3 sample_data/generate.py
npm ci --prefix reporting_suite
npm run build --prefix reporting_suite
python3 reporting_suite/app.py
```

Open [the reporting suite](http://127.0.0.1:8765/). The build produces both the browser app and the CSV export worker. The fixture generator creates one SQLite database for all five customers. Git tracks the generator, schema, example queries and expected manifest. The server stores saved views, schedules and exports separately in `reporting_suite/var/`.

## Verify

After generating the fixtures and building the app, run:

```sh
python3 sample_data/verify.py
(cd reporting_suite && python3 -m unittest test_workspace)
```

## Project documents

- [Reporting requirements and acceptance criteria](CXS_Recognize_Reporting_Requirements_v1.md)
- [Sample customers, data definitions and example queries](sample_data/README.md)
- [Report behavior, roles and local development](reporting_suite/README.md)
