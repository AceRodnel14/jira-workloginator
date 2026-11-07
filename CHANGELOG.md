# Changelog

## 1.1.0

- `/`: the chart has a **Per day / Per week** switch. **Per day** (the default after each fetch) is one line chart
  of hours per day over the whole range, also for ranges longer than a month (weekends shaded, reference line,
  hover for the day total). **Per week** is the existing Monday-to-Sunday bar chart with per-ticket segments.
- `/`: Per week opens on the week that contains today when today is in the range, otherwise on the first week.
- New setting **Work hours per day** (1 to 12 h, default 8; saved with the other settings, applied on the next
  fetch). It moves the reference line on every chart and sets the expected hours on `/multiple`. Settings saved
  before this release load as 8. `PUT /api/settings` and `POST /api/worklogs` reject values outside 1..12 (400).
- `/multiple`: a **Non-working days** field per author (whole days, not saved, reset on each fetch). Expected hours
  become (workdays - non-working days) x work hours, shown as e.g. "Expected 152 h (22 workdays − 3 non-working =
  19 × 8 h)" on screen and in both PDF exports; percent, bar colour and sorting follow it.
- `/multiple`: new **Export PDF (compact)**: each author's header, hours against expected and the hours bar, without
  the day charts, so many authors fit on a page. **Export PDF** is unchanged.

## 1.0.0

First major release: a lot changed at once, some of it breaking for existing setups.

- New logo: blue arrows around a clock, as the browser tab favicon and in the header and login page.
- Breaking: the documented default image is `eacer/jira-workloginator:latest` (README, `dockerdesc.md`, `.env.example`);
  pin a release with `IMAGE=eacer/jira-workloginator:vX.Y` / `vX.Y.Z`.
- Breaking (Postgres setup only): with `docker-compose.db.yml`, `POSTGRES_PASSWORD` must be set in `.env` before the
  first start (Postgres 18 refuses a blank password); Compose stops with `set POSTGRES_PASSWORD` when it is blank or
  unset. The README Quick start and `dockerdesc.md` now say to create `.env` first (`BASE_URL`, and `LOGIN_PASS`
  whenever others can reach the app).
- Images pinned to their minor version, incl. the Alpine variant: `node:24.22-alpine3.24`, `golang:1.26-alpine3.24`,
  `postgres:18.6-alpine3.24`; the distroless runtime keeps its rolling tag.
- The version is built into the binary (`main.version`, Dockerfile `ARG VERSION`) and logged at startup.
- MIT `LICENSE`.
- New page `/multiple` (Menu > Multiple users): up to 50 worklog authors in one fetch (one Jira search for all of
  them, each ticket's worklogs read once). Per author: hours against expected hours (Mon-Fri x 8, weekend hours
  count; green, amber under 50%, above 100% the excess in red over the green bar; shown also while the section is
  collapsed), a per-month line chart, the task list for the open author
  and month, expand/collapse all, sort by percentage and print to PDF. New API `POST /api/worklogs/multi`; saved
  settings gain a `users` list.
- Both pages show a progress page with the fetch log until the data is in; on `/` the log stays below the chart.
- Task lists show one line per ticket per day with the hours summed and first: `hours   KEY title` (start and end
  times are no longer listed).
- `/` chart hover no longer shows the ticket popup: a small date and day-total label stays, the bar splits into coloured per-ticket segments and the day list scrolls
  to that day with matching colours.
- Jira rate-limit (429) and unavailable (503) retries are shown in the fetch log.
- The default colour is now navy (top bar, buttons and links) so the logo stands out; in the dark theme, links and
  badges use a lighter accent so they stay readable (WCAG AA). A custom hue in Appearance gets the same darker shades.
