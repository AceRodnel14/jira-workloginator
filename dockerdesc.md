> Source code, full documentation and issues: https://github.com/AceRodnel14/jira-workloginator

# jira-workloginator

A small web app that shows the hours someone logged in Jira Cloud, per day or per week:
a day-by-day line chart or a Monday-to-Sunday bar chart (hover a day to split it into per-ticket segments), a
console-style fetch log and a day-by-day list of tickets per day. The worklog author can
differ from the API user, so you can view other people's logs.
`/multiple` compares up to 50 authors over one range: hours against expected workday hours
(configurable work hours per day, non-working days per author), a day-by-day chart per month and
full or compact print/PDF export.

## Quick start
```yaml
services:
  app:
    image: eacer/jira-workloginator:latest
    restart: unless-stopped
    ports: ["8080:8080"]
    env_file: .env
    volumes: ["app-data:/data"]
volumes:
  app-data:
```
**Before the first start**, create `.env` from the variables below and set at least `BASE_URL`
(and `LOGIN_PASS` whenever others can reach the app); then `docker compose up -d`, then open
`http://<host>:8080`. For HTTPS, put a reverse
proxy in front and set `BASE_URL` to the public URL.

Or try it with a single `docker run` (json storage; drop `-v ...` to start empty each time):
```bash
docker run --rm -p 8080:8080 -e STORAGE=json -v jira-workloginator-data:/data eacer/jira-workloginator:latest
```

## Configuration
| Variable | Default | Description |
| :- | :- | :- |
| `PORT` | `8080` | HTTP port inside the container |
| `BASE_URL` | `http://localhost:8080` | Public URL as users see it |
| `LOG_LEVEL` | `info` | Log level |
| `LOGIN_PASS` | empty | Password the UI asks for first; empty = no login. Set it whenever others can reach the app (the saved API token is shown to the browser) |
| `STORAGE` | `json` | `json` (`/data/config.json`) or `postgres` |
| `DATABASE_URL` | empty | Postgres URL, only with `STORAGE=postgres` |

Saved settings (Jira site, emails, API token, timezone) live in `/data/config.json`
(plain text, protect the volume) or in Postgres: the repo's `docker-compose.db.yml` runs
the app with a `postgres:18.6-alpine3.24` container. Only `https://*.atlassian.net` sites
are accepted. Health: `/healthz` (liveness), `/readyz` (readiness).

## Tags
`latest` (default, latest stable), `main` (default branch), `vX.Y`, `vX.Y.Z` (releases). Platforms: `linux/amd64`, `linux/arm64`.
