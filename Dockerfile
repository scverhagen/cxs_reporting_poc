FROM node:24-bookworm-slim AS frontend
WORKDIR /app/reporting_suite
COPY reporting_suite/package*.json ./
RUN npm ci --no-audit --no-fund
COPY reporting_suite/index.html reporting_suite/vite.config.js reporting_suite/tsconfig.json ./
COPY reporting_suite/src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM python:3.13-slim-bookworm AS fixtures
WORKDIR /fixtures
COPY sample_data/generate.py sample_data/schema.sql ./
RUN python generate.py

FROM python:3.13-slim-bookworm
WORKDIR /app
# The server invokes Node to render report CSVs.
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
RUN node --version
COPY --from=frontend /app/reporting_suite/package.json ./reporting_suite/
COPY --from=frontend /app/reporting_suite/node_modules ./reporting_suite/node_modules
COPY --from=frontend /app/reporting_suite/build ./reporting_suite/build
COPY --from=frontend /app/reporting_suite/build-worker ./reporting_suite/build-worker
COPY --from=fixtures /fixtures/reporting_poc.sqlite ./sample_data/
COPY reporting_suite/app.py reporting_suite/catalog_data.py reporting_suite/permissions.py reporting_suite/workspace.py ./reporting_suite/
RUN install -d -o nobody -g nogroup /app/reporting_suite/var
USER nobody
ENV PORT=8080 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "reporting_suite/app.py", "--host", "0.0.0.0"]
