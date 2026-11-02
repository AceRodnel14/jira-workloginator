# jira-workloginator

A small web app that shows the hours someone logged in Jira Cloud, one week at a time.
Enter your Jira site, the worklog author's email, the API credentials and a date range.
The app pulls the matching worklogs and shows:
- a progress page with the fetch log while the data comes in (Jira rate-limit retries
  included), then the dashboard;
- a Monday-to-Sunday bar chart of hours per day. Hover a bar to split it into coloured
  per-ticket segments, with a small date and day-total label; the day list on the right scrolls to that day and colours each
  ticket to match;
- a console-style log of the fetch progress and of each week change, below the chart;
- a day-by-day list of the tickets worked on each day, hours summed per ticket (`hours   KEY title`).

The worklog author doesn't have to be the API user: the API email and token only
authenticate, so you can view other people's logs if your Jira account can see them.
Times are shown in the timezone you pick (IANA name, for example `Asia/Manila`).

### Several users: `/multiple`
Open `/multiple` (or **Menu > Multiple users**) to compare up to 50 worklog authors over one
date range. Type each author's email and press Enter to add it to the list. The API email is always
its own field here (no "Same as user"); saving on `/multiple` unticks "Same as user" on `/` only
when the API email differs from the `/` author. The app runs one
Jira search for all of them, shows the fetch log until everything is in, and then shows one
collapsible section per author. The hours bar is always shown, also while the section is collapsed:
- hours worked against the expected hours (Mon-Fri workdays in the range x 8; public holidays
  are not subtracted). Weekend hours count toward the total. The bar is green, amber under
  50%, and above 100% the excess is drawn in red over the full green bar;
- a line chart of hours per day, one month at a time (Prev / Next), weekends shaded;
- the task list on the right follows the author and month you opened last.

**Expand all / Collapse all** and sorting by percentage work on the sections; **Export PDF**
opens the browser's print dialog (choose "Save as PDF") with every section expanded, in the
current order, and every month of the range charted. The 50-author limit keeps the single
Jira search request a safe size.

## Self-hosting

### Requirements
- Docker with the Compose plugin, on `linux/amd64` or `linux/arm64`.
- A Jira Cloud site (`https://<domain>.atlassian.net`) and an
  [API token](https://id.atlassian.com/manage-profile/security/api-tokens).
- Optional: a reverse proxy in front for HTTPS. The app itself only serves plain HTTP
  on port `8080`; set `BASE_URL` to the public URL.

### Quick start
> **Create `.env` from `.env.example` and fill it in before the first start** (at least
> `BASE_URL`, and `LOGIN_PASS` whenever others can reach the app). With
> `docker-compose.db.yml`, `POSTGRES_PASSWORD` is required too (Compose refuses to start without it).

```bash
mkdir jira-workloginator && cd jira-workloginator
curl -fsSLO https://raw.githubusercontent.com/AceRodnel14/jira-workloginator/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/AceRodnel14/jira-workloginator/main/.env.example
# edit .env now: set BASE_URL (and LOGIN_PASS)
docker compose pull
docker compose up -d
```
Open `http://<host>:8080`. Check health with `curl -f http://<host>:8080/healthz`.

### Try it with `docker run`
One container with json storage, no Compose file needed. `--rm` removes the container
when you stop it (Ctrl+C):
```bash
docker run --rm -p 8080:8080 -e STORAGE=json -v jira-workloginator-data:/data eacer/jira-workloginator:latest
```
Open `http://localhost:8080`. The named volume keeps the saved settings
(`/data/config.json`) between runs; leave out `-v ...` to start empty every time. To put a
password in front, add `-e LOGIN_PASS='<password>'`. Remove the saved settings with
`docker volume rm jira-workloginator-data`.

### Configuration
| Variable | Default | Description |
| :- | :- | :- |
| `PORT` | `8080` | HTTP listen port inside the container |
| `BASE_URL` | `http://localhost:8080` | Public URL users see (through the proxy). The login cookie is `Secure` when it starts with `https://` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `LOGIN_PASS` | empty | When set, the UI asks for this password first (session lasts 12 hours). Empty means no login |
| `STORAGE` | `json` | Where saved settings live: `json` (`/data/config.json`) or `postgres` |
| `DATABASE_URL` | empty | Postgres connection URL, used only with `STORAGE=postgres`. `docker-compose.db.yml` builds it for you from the `POSTGRES_*` values |
| `IMAGE` | `eacer/jira-workloginator:latest` | Image (and tag) Compose runs |
| `APP_BIND` / `APP_PORT` | `0.0.0.0` / `8080` | Host address and port to publish on |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | see `.env.example` | Only for `docker-compose.db.yml`. URL-encode special characters in the password |

### Saved settings
Submitting the form saves the Jira site, author email (or the `/multiple` author list), API email, API token and timezone,
so the form is prefilled next time. The date range is never saved: it always starts as the
current month. Nothing is fetched until you press Submit.

- **json (default):** settings go to `/data/config.json`. Without a volume the file
  disappears when the container is replaced (for example after a scale-to-zero), and the
  form simply starts empty. The default `docker-compose.yml` mounts the `app-data` volume.
- **postgres:** use the second Compose file, which runs the app plus a `postgres:18.6-alpine3.24`
  container and sets `STORAGE=postgres` and `DATABASE_URL` itself. Download it, uncomment the
  three `POSTGRES_*` lines in `.env` and set a password, then:
  ```bash
  curl -fsSLO https://raw.githubusercontent.com/AceRodnel14/jira-workloginator/main/docker-compose.db.yml
  docker compose -f docker-compose.db.yml pull
  docker compose -f docker-compose.db.yml up -d
  ```
  The database container only receives its three `POSTGRES_*` values. The app creates its one
  table itself and retries until the database is reachable. To use an external database
  instead, keep `docker-compose.yml` and set `STORAGE=postgres` and `DATABASE_URL` in `.env`.

### Security
- **Set `LOGIN_PASS` whenever anyone else can reach the app.** The saved API token is
  sent back to the browser in full (the form only hides it behind a reveal button), so without a login anyone who
  opens the page can read it.
- The token is stored in plain text in `/data/config.json` or in the database: protect the
  volume and backups accordingly.
- Only `https://*.atlassian.net` sites are accepted, so the server can't be used to call
  arbitrary hosts.
- For HTTPS, put a reverse proxy in front and set `BASE_URL` to the `https://` URL.

### Data and backups
With `STORAGE=json`, data lives in the `app-data` volume (`/data` in the container):
```bash
docker run --rm -v jira-workloginator_app-data:/data -v "$PWD":/backup alpine tar czf /backup/app-data.tgz -C /data .
```
With `docker-compose.db.yml`, the data lives in the `db-data` volume:
```bash
docker compose -f docker-compose.db.yml exec db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > jira-workloginator.sql
```

### Upgrading
`latest` is the latest stable image and what Compose uses by default; `main` follows the default branch. Release tags
`vX.Y` and `vX.Y.Z` are pushed when a release is tagged: pin `IMAGE` to `vX.Y` for patch
updates only, then `docker compose pull && docker compose up -d` (add
`-f docker-compose.db.yml` to both commands for the Postgres setup).

### Health endpoints
- `/healthz`: the process is up (liveness).
- `/readyz`: dependencies are reachable (readiness). With `STORAGE=postgres` it answers
  `503` until the database responds.

## Development
```bash
cp .env.example .env
docker compose up --build   # the whole app, as self-hosters run it
go test ./...
go run ./cmd/app            # backend on :8080
```
`./manual_cicd_lint.sh` runs the CI lint/test jobs locally in throwaway containers (`--list`, `--only`, `--skip`).
With the web UI (`web/`): `npm --prefix web install`, then `npm --prefix web run dev`
(UI on :5173, API proxied to :8080) next to `go run ./cmd/app`; `npm --prefix web test`.
`go run`/`go test` need `web/dist`: run `npm --prefix web run build` once, or create
an empty `web/dist/.keep`. With `STORAGE=json`, saving settings needs a writable `/data`
(the path is fixed at `/data/config.json`); on a dev machine where it isn't, use
`docker compose up --build` instead of `go run`. The Postgres store test runs only when `TEST_DATABASE_URL` is set.
CI (gitlab-actions `templates/app.yml`): lint and tests on branches and merge requests;
on the default branch and release tags a test build with a smoke run, the multi-arch
image push to Docker Hub and the GitHub sync.

---
_Developed with assistance from Claude (Claude Opus 5.5, Claude Sonnet 5.5)._
