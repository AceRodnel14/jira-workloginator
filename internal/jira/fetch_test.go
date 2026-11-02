package jira

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const token = "SECRET-TOKEN-123"

type fake struct {
	mu       sync.Mutex
	requests []*http.Request
	handler  func(w http.ResponseWriter, r *http.Request)
}

func (f *fake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.requests = append(f.requests, r.Clone(context.Background()))
	f.mu.Unlock()
	f.handler(w, r)
}

func (f *fake) paths() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, r := range f.requests {
		out = append(out, r.URL.Path)
	}
	return out
}

func newFake(t *testing.T, h func(w http.ResponseWriter, r *http.Request)) (*fake, *Client) {
	t.Helper()
	f := &fake{handler: h}
	srv := httptest.NewTLSServer(f)
	t.Cleanup(srv.Close)
	hc := srv.Client()
	hc.CheckRedirect = NewHTTPClient().CheckRedirect
	c := NewClient(hc, srv.URL, "me@x.io", token)
	c.sleep = func(context.Context, time.Duration) error { return nil }
	return f, c
}

func writeJSON(w http.ResponseWriter, v any) { _ = json.NewEncoder(w).Encode(v) }

func collect(c *Client, ctx context.Context, req Request) []any {
	var ev []any
	c.Fetch(ctx, req, func(e any) { ev = append(ev, e) })
	return ev
}

func req(user, from, to, tz string) Request {
	f, _ := time.Parse(dateLayout, from)
	t, _ := time.Parse(dateLayout, to)
	loc, err := time.LoadLocation(tz)
	if err != nil {
		panic(err)
	}
	return Request{Users: []string{user}, From: f, To: t, Loc: loc}
}

func last(ev []any) any { return ev[len(ev)-1] }

func wl(acct, started string, secs int) map[string]any {
	return map[string]any{"author": map[string]string{"accountId": acct}, "started": started, "timeSpentSeconds": secs}
}

func TestFetchHappyPath(t *testing.T) {
	var searchQueries []string
	f, c := newFake(t, func(w http.ResponseWriter, r *http.Request) {
		if u, p, ok := r.BasicAuth(); !ok || u != "me@x.io" || p != token {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/rest/api/3/myself":
			writeJSON(w, map[string]string{"accountId": "acc1", "displayName": "Me Myself"})
		case "/rest/api/3/search/jql":
			searchQueries = append(searchQueries, r.URL.RawQuery)
			tok := r.URL.Query().Get("nextPageToken")
			switch tok {
			case "":
				writeJSON(w, map[string]any{"issues": []any{map[string]any{"key": "A-1", "fields": map[string]string{"summary": "One"}}}, "nextPageToken": "p2"})
			case "p2":
				writeJSON(w, map[string]any{"issues": []any{map[string]any{"key": "A-2", "fields": map[string]string{"summary": "Two"}}}, "nextPageToken": "p3"})
			default:
				writeJSON(w, map[string]any{"issues": []any{map[string]any{"key": "A-3", "fields": map[string]string{"summary": "Three"}}}, "isLast": true})
			}
		case "/rest/api/3/issue/A-1/worklog":
			// two pages of one entry each, total 2
			if r.URL.Query().Get("startAt") == "0" {
				writeJSON(w, map[string]any{"total": 2, "worklogs": []any{wl("acc1", "2026-10-01T09:00:00.000+0000", 5400)}})
			} else {
				writeJSON(w, map[string]any{"total": 2, "worklogs": []any{
					wl("acc1", "2026-10-01T08:00:00.000+0000", 3600),
					wl("other", "2026-10-01T08:00:00.000+0000", 9999), // other author: dropped
				}})
			}
		case "/rest/api/3/issue/A-2/worklog":
			writeJSON(w, map[string]any{"total": 1, "worklogs": []any{wl("acc1", "2026-10-01T23:30:00.000+0000", 3600)}}) // crosses midnight
		case "/rest/api/3/issue/A-3/worklog":
			writeJSON(w, map[string]any{"total": 0, "worklogs": []any{}})
		default:
			w.WriteHeader(404)
		}
	})
	ev := collect(c, context.Background(), req("ME@x.io", "2026-10-01", "2026-10-31", "Etc/UTC"))

	done, ok := last(ev).(Done)
	if !ok || done.Issues != 3 || done.Worklogs != 3 || done.Seconds != 5400+3600+3600 {
		t.Fatalf("done: %+v", last(ev))
	}
	var issues []Issue
	for _, e := range ev {
		if is, ok := e.(Issue); ok {
			issues = append(issues, is)
		}
	}
	if len(issues) != 3 || issues[2].Seconds != 0 || len(issues[2].Worklogs) != 0 || issues[2].Index != 3 || issues[2].Count != 3 {
		t.Fatalf("issues: %+v", issues)
	}
	if got := issues[0].Worklogs; len(got) != 2 || got[0].Start != "08:00" || got[1].Start != "09:00" || got[1].End != "10:30" {
		t.Errorf("A-1 worklogs (sorted by start): %+v", got)
	}
	if got := issues[1].Worklogs[0]; got.End != "00:30" || got.EndDayOffset != 1 || got.Date != "2026-10-01" {
		t.Errorf("A-2 midnight crossing: %+v", got)
	}
	if len(searchQueries) != 3 {
		t.Errorf("search paging: %d requests", len(searchQueries))
	}
	if !strings.Contains(searchQueries[0], "2026-09-30") || !strings.Contains(searchQueries[0], "2026-11-01") || !strings.Contains(searchQueries[0], "acc1") {
		t.Errorf("JQL not widened: %s", searchQueries[0])
	}
	if p := f.paths(); p[0] != "/rest/api/3/myself" {
		t.Errorf("paths: %v", p)
	}
	// every event must serialise
	for _, e := range ev {
		if _, err := json.Marshal(e); err != nil {
			t.Error(err)
		}
	}
}

func TestWorklogWindowAndTimezone(t *testing.T) {
	// Asia/Manila is UTC+8. 2026-09-30T16:30Z = 2026-10-01 00:30 local (inside FROM);
	// 2026-09-30T15:59Z = 2026-09-30 23:59 local (outside); 2026-10-31T15:59Z = 10-31 23:59 local (inside);
	// 2026-10-31T16:00Z = 11-01 00:00 local (outside).
	var query string
	_, c := newFake(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rest/api/3/myself":
			writeJSON(w, map[string]string{"accountId": "a"})
		case "/rest/api/3/search/jql":
			writeJSON(w, map[string]any{"issues": []any{map[string]any{"key": "A-1", "fields": map[string]string{"summary": "S"}}}, "isLast": true})
		default:
			query = r.URL.RawQuery
			writeJSON(w, map[string]any{"total": 4, "worklogs": []any{
				wl("a", "2026-09-30T16:30:00.000+0000", 60),
				wl("a", "2026-09-30T15:59:00.000+0000", 60),
				wl("a", "2026-10-31T15:59:00.000+0000", 60),
				wl("a", "2026-10-31T16:00:00.000+0000", 60),
			}})
		}
	})
	ev := collect(c, context.Background(), req("me@x.io", "2026-10-01", "2026-10-31", "Asia/Manila"))
	is := firstIssue(ev)
	if len(is.Worklogs) != 2 || is.Worklogs[0].Date != "2026-10-01" || is.Worklogs[0].Start != "00:30" || is.Worklogs[1].Date != "2026-10-31" {
		t.Fatalf("%+v", is.Worklogs)
	}
	// widened epoch window: FROM 00:00 local - 1 day, TO+1 00:00 local + 1 day
	loc, _ := time.LoadLocation("Asia/Manila")
	wantAfter := time.Date(2026, 9, 30, 0, 0, 0, 0, loc).UnixMilli()
	if !strings.Contains(query, fmt.Sprintf("startedAfter=%d", wantAfter)) {
		t.Errorf("query %s lacks startedAfter=%d", query, wantAfter)
	}
	// the same UTC instant lands on a different day in another zone
	_, c2 := newFake(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rest/api/3/myself":
			writeJSON(w, map[string]string{"accountId": "a"})
		case "/rest/api/3/search/jql":
			writeJSON(w, map[string]any{"issues": []any{map[string]any{"key": "A-1", "fields": map[string]string{"summary": "S"}}}, "isLast": true})
		default:
			writeJSON(w, map[string]any{"total": 1, "worklogs": []any{wl("a", "2026-10-01T20:00:00.000+0000", 60)}})
		}
	})
	utc := firstIssue(collect(c2, context.Background(), req("me@x.io", "2026-10-01", "2026-10-02", "Etc/UTC")))
	mnl := firstIssue(collect(c2, context.Background(), req("me@x.io", "2026-10-01", "2026-10-02", "Asia/Manila")))
	if utc.Worklogs[0].Date != "2026-10-01" || mnl.Worklogs[0].Date != "2026-10-02" {
		t.Errorf("tz day shift: %v vs %v", utc.Worklogs, mnl.Worklogs)
	}
}

func TestResolveUser(t *testing.T) {
	for name, tt := range map[string]struct {
		users   any
		wantErr string
		wantID  string
	}{
		"exact match among many": {[]jiraUser{{"x", "X", "other@x.io"}, {"id2", "Bob", "Bob@x.io"}}, "", "id2"},
		"hidden email single":    {[]jiraUser{{"id3", "Hidden", ""}}, "", "id3"},
		"single but other email": {[]jiraUser{{"id4", "Other", "other@x.io"}}, "could not tell", ""},
		"none":                   {[]jiraUser{}, "no Jira user", ""},
		"many hidden":            {[]jiraUser{{"a", "A", ""}, {"b", "B", ""}}, "could not tell", ""},
	} {
		t.Run(name, func(t *testing.T) {
			var query string
			_, c := newFake(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/rest/api/3/user/search" {
					w.WriteHeader(404)
					return
				}
				query = r.URL.Query().Get("query")
				writeJSON(w, tt.users)
			})
			id, _, err := c.resolveUser(context.Background(), "bob@x.io")
			if query != "bob@x.io" {
				t.Errorf("query %q", query)
			}
			if tt.wantErr == "" && (err != nil || id != tt.wantID) {
				t.Errorf("id %q err %v", id, err)
			}
			if tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)) {
				t.Errorf("err %v", err)
			}
		})
	}
}

func TestFatalOnUserFailure(t *testing.T) {
	_, c := newFake(t, func(w http.ResponseWriter, r *http.Request) { writeJSON(w, []jiraUser{}) })
	ev := collect(c, context.Background(), req("nobody@x.io", "2026-10-01", "2026-10-02", "Etc/UTC"))
	if e, ok := last(ev).(Error); !ok || !e.Fatal {
		t.Fatalf("%+v", last(ev))
	}
}

func TestJira401IsFatalWithoutToken(t *testing.T) {
	_, c := newFake(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		// Jira may echo odd things; the raw body must never be forwarded.
		_, _ = w.Write([]byte(`{"errorMessages":["Client must be authenticated"],"debug":"` + token + `"}`))
	})
	ev := collect(c, context.Background(), req("me@x.io", "2026-10-01", "2026-10-02", "Etc/UTC"))
	e, ok := last(ev).(Error)
	if len(ev) < 1 || !ok || !e.Fatal || !strings.Contains(e.Msg, "401") || !strings.Contains(e.Msg, "must be authenticated") {
		t.Fatalf("%+v", ev)
	}
	b, _ := json.Marshal(ev)
	if strings.Contains(string(b), token) {
		t.Error("token leaked into stream")
	}
}

func TestRetryAfter(t *testing.T) {
	for name, tt := range map[string]struct {
		failures int
		wantErr  bool
		wantReqs int
	}{
		"recovers after two": {2, false, 3},
		"gives up after 3":   {99, true, 4},
	} {
		t.Run(name, func(t *testing.T) {
			n := 0
			var waits []time.Duration
			f, c := newFake(t, func(w http.ResponseWriter, r *http.Request) {
				n++
				if n <= tt.failures {
					w.Header().Set("Retry-After", "7")
					w.WriteHeader(429)
					return
				}
				writeJSON(w, map[string]string{"accountId": "a"})
			})
			c.sleep = func(_ context.Context, d time.Duration) error { waits = append(waits, d); return nil }
			var me jiraUser
			err := c.get(context.Background(), "/rest/api/3/myself", nil, &me)
			if (err != nil) != tt.wantErr || len(f.paths()) != tt.wantReqs {
				t.Errorf("err %v, reqs %d", err, len(f.paths()))
			}
			for _, d := range waits {
				if d != 7*time.Second {
					t.Errorf("wait %v", d)
				}
			}
		})
	}
}

func TestRedirectIsError(t *testing.T) {
	_, c := newFake(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://evil.example/", http.StatusFound)
	})
	err := c.get(context.Background(), "/rest/api/3/myself", nil, &jiraUser{})
	var he *HTTPError
	if !errors.As(err, &he) || he.Status != 302 {
		t.Errorf("err %v", err)
	}
}

func TestErrorTextTruncated(t *testing.T) {
	_, c := newFake(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		writeJSON(w, map[string]any{"errorMessages": []string{strings.Repeat("x", 1000)}})
	})
	err := c.get(context.Background(), "/rest/api/3/myself", nil, &jiraUser{})
	if err == nil || len(err.Error()) > 400 {
		t.Errorf("len %d", len(err.Error()))
	}
}

func TestCancellationStopsCalls(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	f, c := newFake(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rest/api/3/myself":
			writeJSON(w, map[string]string{"accountId": "a"})
		case "/rest/api/3/search/jql":
			var issues []any
			for i := 1; i <= 5; i++ {
				issues = append(issues, map[string]any{"key": fmt.Sprintf("A-%d", i), "fields": map[string]string{"summary": "S"}})
			}
			writeJSON(w, map[string]any{"issues": issues, "isLast": true})
		default:
			cancel() // the user cancels while the first issue is being fetched
			writeJSON(w, map[string]any{"total": 0, "worklogs": []any{}})
		}
	})
	ev := collect(c, ctx, req("me@x.io", "2026-10-01", "2026-10-02", "Etc/UTC"))
	for _, e := range ev {
		switch e.(type) {
		case Done, Error:
			t.Errorf("unexpected %T after cancel", e)
		}
	}
	worklogCalls := 0
	for _, p := range f.paths() {
		if strings.HasSuffix(p, "/worklog") {
			worklogCalls++
		}
	}
	if worklogCalls != 1 {
		t.Errorf("worklog calls after cancel: %d", worklogCalls)
	}
}

func firstIssue(ev []any) Issue {
	for _, e := range ev {
		if is, ok := e.(Issue); ok {
			return is
		}
	}
	panic("no issue event")
}

// DST days are 25h (fall back) or 23h (spring forward) long: the window
// [FROM 00:00, TO+1 00:00) is computed in the zone, and day/start/end/offset follow local time.
func TestWorklogsAcrossDST(t *testing.T) {
	type want struct {
		date, start, end string
		offset           int
	}
	for name, tt := range map[string]struct {
		day     string // FROM = TO
		started []string
		secs    []int
		want    []want // in start order; dropped worklogs are simply absent
	}{
		"fall back 2026-10-25 (Berlin, 25h day)": {
			day: "2026-10-25",
			started: []string{
				"2026-10-24T21:59:00.000+0000", // 10-24 23:59 CEST: before the day
				"2026-10-24T22:00:00.000+0000", // 10-25 00:00 CEST: first instant
				"2026-10-25T00:30:00.000+0000", // 02:30 CEST (first 02:xx), 1h -> 02:30 CET
				"2026-10-25T01:30:00.000+0000", // 02:30 CET (second 02:xx)
				"2026-10-25T22:59:00.000+0000", // 23:59 CET, 2h -> 01:59 next day (CET = UTC+1)
				"2026-10-25T23:00:00.000+0000", // 10-26 00:00 CET: after the day (25h later)
			},
			secs: []int{60, 60, 3600, 60, 7200, 60},
			want: []want{
				{"2026-10-25", "00:00", "00:01", 0},
				{"2026-10-25", "02:30", "02:30", 0},
				{"2026-10-25", "02:30", "02:31", 0},
				{"2026-10-25", "23:59", "01:59", 1},
			},
		},
		"spring forward 2026-03-29 (Berlin, 23h day)": {
			day: "2026-03-29",
			started: []string{
				"2026-03-28T22:59:00.000+0000", // 03-28 23:59 CET: before the day
				"2026-03-28T23:00:00.000+0000", // 03-29 00:00 CET: first instant
				"2026-03-29T00:59:00.000+0000", // 01:59 CET, 1h -> 03:59 CEST
				"2026-03-29T01:00:00.000+0000", // 03:00 CEST (02:xx does not exist)
				"2026-03-29T21:59:00.000+0000", // 23:59 CEST, 1h -> 00:59 next day
				"2026-03-29T22:00:00.000+0000", // 03-30 00:00 CEST: after the day (23h later)
			},
			secs: []int{60, 60, 3600, 60, 3600, 60},
			want: []want{
				{"2026-03-29", "00:00", "00:01", 0},
				{"2026-03-29", "01:59", "03:59", 0},
				{"2026-03-29", "03:00", "03:01", 0},
				{"2026-03-29", "23:59", "00:59", 1},
			},
		},
	} {
		t.Run(name, func(t *testing.T) {
			_, c := newFake(t, func(w http.ResponseWriter, _ *http.Request) {
				var logs []any
				for i, s := range tt.started {
					logs = append(logs, wl("a", s, tt.secs[i]))
				}
				writeJSON(w, map[string]any{"total": len(logs), "worklogs": logs})
			})
			loc, err := time.LoadLocation("Europe/Berlin")
			if err != nil {
				t.Fatal(err)
			}
			day, _ := time.Parse(dateLayout, tt.day)
			start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc)
			end := time.Date(day.Year(), day.Month(), day.Day()+1, 0, 0, 0, 0, loc)
			perAcct, err := c.worklogs(context.Background(), "A-1", map[string][]*author{"a": nil}, start, end, loc)
			got := perAcct["a"]
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != len(tt.want) {
				t.Fatalf("got %d worklogs %+v, want %d", len(got), got, len(tt.want))
			}
			for i, w := range tt.want {
				g := got[i]
				if g.Date != w.date || g.Start != w.start || g.End != w.end || g.EndDayOffset != w.offset {
					t.Errorf("[%d] got %+v, want %+v", i, g, w)
				}
			}
		})
	}
}

// ---- multi-user pipeline ----

func multiReq(from, to, tz string, users ...string) Request {
	r := req("", from, to, tz)
	r.Users, r.Multi = users, true
	return r
}

func issueRow(key string) map[string]any {
	return map[string]any{"key": key, "fields": map[string]string{"summary": "S " + key}}
}

// multiFake knows users u1@x.io, u2@x.io, u3@x.io (accounts a1..a3) and the given issues.
func multiFake(t *testing.T, searchPages map[string]map[string]any, worklogs map[string][]any) (*fake, *Client) {
	return newFake(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/user/search"):
			q := r.URL.Query().Get("query")
			if q == "ghost@x.io" {
				writeJSON(w, []jiraUser{})
				return
			}
			writeJSON(w, []jiraUser{{"a" + q[1:2], "Name " + q[:2], q}})
		case strings.HasSuffix(r.URL.Path, "/search/jql"):
			writeJSON(w, searchPages[r.URL.Query().Get("nextPageToken")])
		case strings.HasSuffix(r.URL.Path, "/worklog"):
			key := strings.Split(r.URL.Path, "/")[5]
			all := worklogs[key]
			start, _ := strconv.Atoi(r.URL.Query().Get("startAt"))
			end := min(start+2, len(all)) // pages of two
			writeJSON(w, map[string]any{"total": len(all), "worklogs": all[start:end]})
		default:
			w.WriteHeader(404)
		}
	})
}

func count[T any](ev []any) []T {
	var out []T
	for _, e := range ev {
		if v, ok := e.(T); ok {
			out = append(out, v)
		}
	}
	return out
}

func searches(f *fake) []*http.Request {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*http.Request
	for _, r := range f.requests {
		if strings.HasSuffix(r.URL.Path, "/search/jql") {
			out = append(out, r)
		}
	}
	return out
}

func TestMultiOneSearchSplitByAuthor(t *testing.T) {
	f, c := multiFake(t,
		map[string]map[string]any{
			"":   {"issues": []any{issueRow("A-1")}, "nextPageToken": "p2"},
			"p2": {"issues": []any{issueRow("A-2")}, "isLast": true},
		},
		map[string][]any{
			// 2 tracked authors + 1 untracked, over two pages (startAt paging); A-1 fetched once.
			"A-1": {
				wl("a1", "2026-10-01T09:00:00.000+0000", 3600),
				wl("zz", "2026-10-01T09:00:00.000+0000", 999),
				wl("a2", "2026-10-02T09:00:00.000+0000", 1800),
				wl("a1", "2026-09-30T23:59:00.000+0000", 60), // before the range: dropped
			},
			"A-2": {wl("a2", "2026-10-03T10:00:00.000+0000", 600)},
		})
	ev := collect(c, context.Background(), multiReq("2026-10-01", "2026-10-31", "Etc/UTC", "u1@x.io", "u2@x.io", "u3@x.io"))

	ss := searches(f)
	if len(ss) != 2 { // one search, two pages
		t.Fatalf("search requests: %d", len(ss))
	}
	jql := ss[0].URL.Query().Get("jql")
	want := `worklogAuthor in ("a1","a2","a3") AND worklogDate >= "2026-09-30" AND worklogDate <= "2026-11-01"`
	if jql != want {
		t.Errorf("jql %s", jql)
	}
	wlCalls := map[string]int{}
	for _, p := range f.paths() {
		if strings.HasSuffix(p, "/worklog") {
			wlCalls[p]++
		}
	}
	if wlCalls["/rest/api/3/issue/A-1/worklog"] != 2 || wlCalls["/rest/api/3/issue/A-2/worklog"] != 1 { // A-1: two pages
		t.Errorf("worklog calls: %v", wlCalls)
	}
	is := count[Issue](ev)
	if len(is) != 3 || is[0].Author != "u1@x.io" || is[1].Author != "u2@x.io" || is[1].Key != "A-1" || is[2].Key != "A-2" || is[2].Author != "u2@x.io" {
		t.Fatalf("issue events: %+v", is)
	}
	if is[0].Seconds != 3600 || len(is[0].Worklogs) != 1 || is[0].Index != 1 || is[0].Count != 2 {
		t.Errorf("u1 issue: %+v", is[0])
	}
	dn := count[Done](ev)
	if len(dn) != 3 || dn[0].Author != "u1@x.io" || dn[0].Issues != 1 || dn[1].Issues != 2 || dn[1].Seconds != 2400 ||
		dn[2].Author != "u3@x.io" || dn[2].Issues != 0 || dn[2].Seconds != 0 {
		t.Errorf("done events: %+v", dn)
	}
	if ad, ok := last(ev).(AllDone); !ok || ad.Authors != 3 || ad.Seconds != 3600+2400 {
		t.Errorf("last: %+v", last(ev))
	}
	if n := len(count[Issues](ev)); n != 1 || count[Issues](ev)[0].Count != 2 {
		t.Errorf("issues event: %+v", count[Issues](ev))
	}
	for _, u := range count[User](ev) {
		if u.Author == "" {
			t.Errorf("user without author: %+v", u)
		}
	}
}

func TestMultiExactTimeFilterInZone(t *testing.T) {
	_, c := multiFake(t,
		map[string]map[string]any{"": {"issues": []any{issueRow("A-1")}, "isLast": true}},
		map[string][]any{"A-1": {
			wl("a1", "2026-09-30T16:30:00.000+0000", 60), // 10-01 00:30 Manila: in
			wl("a1", "2026-09-30T15:59:00.000+0000", 60), // 09-30 23:59 Manila: out
			wl("a1", "2026-10-31T16:00:00.000+0000", 60), // 11-01 00:00 Manila: out
		}})
	ev := collect(c, context.Background(), multiReq("2026-10-01", "2026-10-31", "Asia/Manila", "u1@x.io"))
	is := count[Issue](ev)
	if len(is) != 1 || len(is[0].Worklogs) != 1 || is[0].Worklogs[0].Start != "00:30" {
		t.Errorf("%+v", is)
	}
}

func TestMultiUnresolvedContinues(t *testing.T) {
	f, c := multiFake(t,
		map[string]map[string]any{"": {"issues": []any{issueRow("A-1")}, "isLast": true}},
		map[string][]any{"A-1": {wl("a1", "2026-10-01T09:00:00.000+0000", 60)}})
	ev := collect(c, context.Background(), multiReq("2026-10-01", "2026-10-02", "Etc/UTC", "ghost@x.io", "u1@x.io"))
	es := count[Error](ev)
	if len(es) != 1 || es[0].Author != "ghost@x.io" || !es[0].Fatal {
		t.Fatalf("errors: %+v", es)
	}
	if ad, ok := last(ev).(AllDone); !ok || ad.Authors != 1 {
		t.Errorf("last: %+v", last(ev))
	}
	if q := searches(f)[0].URL.Query().Get("jql"); strings.Contains(q, "ghost") || !strings.Contains(q, `("a1")`) {
		t.Errorf("jql %s", q)
	}
}

func TestMultiNoneResolved(t *testing.T) {
	f, c := multiFake(t, nil, nil)
	ev := collect(c, context.Background(), multiReq("2026-10-01", "2026-10-02", "Etc/UTC", "ghost@x.io"))
	if ad, ok := last(ev).(AllDone); !ok || ad.Authors != 0 || ad.Seconds != 0 {
		t.Errorf("last: %+v", last(ev))
	}
	if len(searches(f)) != 0 {
		t.Error("search must not run")
	}
	if len(count[Done](ev)) != 0 {
		t.Error("no done events expected")
	}
}

func TestMultiSearch401IsRunFatal(t *testing.T) {
	_, c := newFake(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/search/jql") {
			w.WriteHeader(401)
			return
		}
		writeJSON(w, []jiraUser{{"a1", "N", "u1@x.io"}})
	})
	ev := collect(c, context.Background(), multiReq("2026-10-01", "2026-10-02", "Etc/UTC", "u1@x.io"))
	e, ok := last(ev).(Error)
	if !ok || !e.Fatal || e.Author != "" {
		t.Fatalf("last: %+v", last(ev))
	}
	for _, x := range ev {
		if _, bad := x.(AllDone); bad {
			t.Error("all_done after fatal")
		}
	}
}

func TestMultiPerIssueErrorContinues(t *testing.T) {
	_, c := newFake(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/user/search"):
			writeJSON(w, []jiraUser{{"a1", "N", "u1@x.io"}})
		case strings.HasSuffix(r.URL.Path, "/search/jql"):
			writeJSON(w, map[string]any{"issues": []any{issueRow("A-1"), issueRow("A-2")}, "isLast": true})
		case strings.Contains(r.URL.Path, "A-1"):
			w.WriteHeader(500)
		default:
			writeJSON(w, map[string]any{"total": 1, "worklogs": []any{wl("a1", "2026-10-01T09:00:00.000+0000", 60)}})
		}
	})
	ev := collect(c, context.Background(), multiReq("2026-10-01", "2026-10-02", "Etc/UTC", "u1@x.io"))
	es := count[Error](ev)
	if len(es) != 1 || es[0].Fatal || es[0].Author != "" || !strings.HasPrefix(es[0].Msg, "A-1: ") {
		t.Fatalf("errors: %+v", es)
	}
	if len(count[Issue](ev)) != 1 {
		t.Errorf("issues: %+v", count[Issue](ev))
	}
	if _, ok := last(ev).(AllDone); !ok {
		t.Errorf("last: %+v", last(ev))
	}
}

func TestRetryLines(t *testing.T) {
	for name, tt := range map[string]struct {
		status int
		header string
		want   string
	}{
		"429 with Retry-After": {429, "5", "Jira answered 429 (rate limited); retrying in 5 s (retry 1 of 3)"},
		"503 fallback wait":    {503, "", "Jira answered 503 (unavailable); retrying in 1 s (retry 1 of 3)"},
		"capped at 30":         {429, "999", "Jira answered 429 (rate limited); retrying in 30 s (retry 1 of 3)"},
	} {
		t.Run(name, func(t *testing.T) {
			n := 0
			_, c := newFake(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/rest/api/3/myself" && n == 0 {
					n++
					if tt.header != "" {
						w.Header().Set("Retry-After", tt.header)
					}
					w.WriteHeader(tt.status)
					return
				}
				switch r.URL.Path {
				case "/rest/api/3/myself":
					writeJSON(w, map[string]string{"accountId": "a", "displayName": "Me"})
				case "/rest/api/3/search/jql":
					writeJSON(w, map[string]any{"issues": []any{}, "isLast": true})
				}
			})
			var slept []time.Duration
			c.sleep = func(_ context.Context, d time.Duration) error { slept = append(slept, d); return nil }
			ev := collect(c, context.Background(), req("me@x.io", "2026-10-01", "2026-10-02", "Etc/UTC"))
			es := count[Error](ev)
			if len(es) != 1 || es[0].Msg != tt.want || es[0].Fatal || es[0].Author != "" {
				t.Fatalf("errors: %+v", es)
			}
			if len(slept) != 1 {
				t.Errorf("slept %v", slept)
			}
			if _, ok := last(ev).(Done); !ok {
				t.Errorf("run did not recover: %+v", last(ev))
			}
		})
	}
}

// The single-user event sequence is part of the contract with the UI: no author
// tags, no all_done, retry-free.
func TestSingleModeGolden(t *testing.T) {
	_, c := newFake(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rest/api/3/myself":
			writeJSON(w, map[string]string{"accountId": "acc1", "displayName": "Me Myself"})
		case "/rest/api/3/search/jql":
			writeJSON(w, map[string]any{"issues": []any{issueRow("A-1"), issueRow("A-2")}, "isLast": true})
		case "/rest/api/3/issue/A-1/worklog":
			writeJSON(w, map[string]any{"total": 1, "worklogs": []any{wl("acc1", "2026-10-01T09:00:00.000+0000", 5400)}})
		default:
			writeJSON(w, map[string]any{"total": 1, "worklogs": []any{wl("other", "2026-10-01T09:00:00.000+0000", 5400)}})
		}
	})
	var lines []string
	c.Fetch(context.Background(), req("me@x.io", "2026-10-01", "2026-10-31", "Etc/UTC"), func(e any) {
		b, _ := json.Marshal(e)
		lines = append(lines, string(b))
	})
	want := strings.Join([]string{
		`{"type":"log","msg":"Looking up the Jira user"}`,
		`{"type":"user","display_name":"Me Myself"}`,
		`{"type":"log","msg":"Searching issues with worklogs"}`,
		`{"type":"issues","count":2}`,
		`{"type":"issue","index":1,"count":2,"key":"A-1","summary":"S A-1","seconds":5400,"worklogs":[{"date":"2026-10-01","start":"09:00","end":"10:30","end_day_offset":0,"seconds":5400}]}`,
		`{"type":"issue","index":2,"count":2,"key":"A-2","summary":"S A-2","seconds":0,"worklogs":[]}`,
		`{"type":"done","issues":2,"worklogs":1,"seconds":5400}`,
	}, "\n")
	if got := strings.Join(lines, "\n"); got != want {
		t.Errorf("got:\n%s\nwant:\n%s", got, want)
	}
}

// The 50-user cap exists because the JQL travels in the GET URL.
func TestSearchURLStaysUnder8KB(t *testing.T) {
	var uriLen int
	_, c := newFake(t, func(w http.ResponseWriter, r *http.Request) {
		uriLen = len(r.RequestURI)
		writeJSON(w, map[string]any{"issues": []any{}, "isLast": true})
	})
	accts := make([]string, 50)
	for i := range accts {
		accts[i] = fmt.Sprintf("%03d", i) + strings.Repeat("a", 125)
	}
	from, _ := time.Parse(dateLayout, "2026-10-01")
	if _, err := c.searchIssues(context.Background(), accts, from, from); err != nil {
		t.Fatal(err)
	}
	if uriLen == 0 || uriLen >= 8<<10 {
		t.Errorf("request URI length %d, want under 8192", uriLen)
	}
}
