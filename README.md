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

## Deploy on DigitalOcean App Platform

1. In App Platform, select the GitHub repository `scverhagen/cxs_reporting_poc`, branch `main`, and the repository root (`/`) as the source directory. The root [Dockerfile](Dockerfile) builds the dashboard, CSV worker, Python API and all five sample datasets.
2. Use one **Web Service** instance with HTTP port `8080` and route `/`. Leave the build and run command overrides blank so the Dockerfile controls startup.
3. Add a runtime environment variable named `REPORTING_PUBLIC_URL` with the value `${APP_URL}`. DigitalOcean fills in the public address for download links in report-ready emails. [Environment variable reference](https://docs.digitalocean.com/products/app-platform/how-to/use-environment-variables/)
4. Deploy, open the app URL and select a sample customer. The dashboard and the reporting API share that URL.

The sample datasets are included in each deployment. Saved views, schedules, branding overrides and export history live in the instance’s writable SQLite database and reset when DigitalOcean replaces the instance, including on redeploy. [App Platform storage limits](https://docs.digitalocean.com/products/app-platform/details/limits/)

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
