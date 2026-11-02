package jira

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

const dateLayout = "2006-01-02"

// Stream events (one NDJSON line each). Author is set only in multi-user runs.
type (
	Log struct {
		Type string `json:"type"`
		Msg  string `json:"msg"`
	}
	User struct {
		Type        string `json:"type"`
		Author      string `json:"author,omitempty"`
		DisplayName string `json:"display_name"`
	}
	Issues struct {
		Type  string `json:"type"`
		Count int    `json:"count"`
	}
	Entry struct {
		Date         string `json:"date"`
		Start        string `json:"start"`
		End          string `json:"end"`
		EndDayOffset int    `json:"end_day_offset"`
		Seconds      int    `json:"seconds"`
	}
	Issue struct {
		Type     string  `json:"type"`
		Author   string  `json:"author,omitempty"`
		Index    int     `json:"index"`
		Count    int     `json:"count"`
		Key      string  `json:"key"`
		Summary  string  `json:"summary"`
		Seconds  int     `json:"seconds"`
		Worklogs []Entry `json:"worklogs"`
	}
	Error struct {
		Type   string `json:"type"`
		Author string `json:"author,omitempty"`
		Msg    string `json:"msg"`
		Fatal  bool   `json:"fatal"`
	}
	Done struct {
		Type     string `json:"type"`
		Author   string `json:"author,omitempty"`
		Issues   int    `json:"issues"`
		Worklogs int    `json:"worklogs"`
		Seconds  int    `json:"seconds"`
	}
	// AllDone ends a multi-user run.
	AllDone struct {
		Type    string `json:"type"`
		Authors int    `json:"authors"`
		Seconds int    `json:"seconds"`
	}
)

// Request is one fetch: whose worklogs (emails), which days (UTC-midnight
// dates), in which zone. Multi selects the multi-user event shape (author
// tags, all_done); otherwise Users holds exactly one email.
type Request struct {
	Users []string
	Multi bool
	From  time.Time
	To    time.Time
	Loc   *time.Location
}

// author is one resolved person.
type author struct {
	email, acct string
	issues      int
	logs, secs  int
}

// Fetch resolves the users, runs ONE issue search for all of them, then fetches
// each issue's worklogs once (sequentially) and splits them by author, calling
// emit per event. It stops quietly when ctx ends. A single-user run always ends
// with Done or a fatal Error; a multi-user run with AllDone or a fatal Error.
// A Client must not run two fetches at once: onRetry is set here and cleared by defer.
func (c *Client) Fetch(ctx context.Context, req Request, emit func(any)) {
	tag := func(email string) string {
		if req.Multi {
			return email
		}
		return ""
	}
	fatal := func(err error) {
		if ctx.Err() == nil {
			emit(Error{Type: "error", Msg: err.Error(), Fatal: true})
		}
	}
	c.onRetry = func(status int, wait time.Duration, retry, of int) {
		if ctx.Err() == nil {
			emit(Error{Type: "error", Msg: retryMsg(status, wait, retry, of)})
		}
	}
	defer func() { c.onRetry = nil }()

	if req.Multi {
		emit(Log{"log", "Looking up Jira users"})
	} else {
		emit(Log{"log", "Looking up the Jira user"})
	}
	var authors []*author
	byAcct := map[string][]*author{}
	for _, email := range req.Users {
		acct, name, err := c.resolveUser(ctx, email)
		var nf *notFoundError
		if errors.As(err, &nf) && req.Multi {
			emit(Error{Type: "error", Author: email, Msg: err.Error(), Fatal: true})
			continue
		}
		if err != nil {
			fatal(err)
			return
		}
		emit(User{Type: "user", Author: tag(email), DisplayName: name})
		a := &author{email: email, acct: acct}
		authors = append(authors, a)
		byAcct[acct] = append(byAcct[acct], a)
	}
	if len(authors) == 0 {
		emit(AllDone{"all_done", 0, 0})
		return
	}

	emit(Log{"log", "Searching issues with worklogs"})
	accts := make([]string, 0, len(byAcct))
	for _, a := range authors {
		if !slices.Contains(accts, a.acct) {
			accts = append(accts, a.acct)
		}
	}
	issues, err := c.searchIssues(ctx, accts, req.From, req.To)
	if err != nil {
		fatal(err)
		return
	}
	emit(Issues{"issues", len(issues)})

	rangeStart := time.Date(req.From.Year(), req.From.Month(), req.From.Day(), 0, 0, 0, 0, req.Loc)
	rangeEnd := time.Date(req.To.Year(), req.To.Month(), req.To.Day()+1, 0, 0, 0, 0, req.Loc)
	for i, is := range issues {
		if ctx.Err() != nil {
			return
		}
		perAcct, err := c.worklogs(ctx, is.Key, byAcct, rangeStart, rangeEnd, req.Loc)
		if err != nil {
			var he *HTTPError
			fatalErr := errors.As(err, &he) && he.Auth()
			if ctx.Err() == nil {
				emit(Error{Type: "error", Msg: fmt.Sprintf("%s: %v", is.Key, err), Fatal: fatalErr})
			}
			if fatalErr || ctx.Err() != nil {
				return
			}
			continue
		}
		for _, a := range authors {
			entries := perAcct[a.acct]
			if req.Multi && len(entries) == 0 {
				continue
			}
			if entries == nil {
				entries = []Entry{}
			}
			secs := 0
			for _, e := range entries {
				secs += e.Seconds
			}
			a.issues++
			a.logs += len(entries)
			a.secs += secs
			emit(Issue{"issue", tag(a.email), i + 1, len(issues), is.Key, is.Summary, secs, entries})
		}
	}
	total := 0
	for _, a := range authors {
		n := a.issues
		if !req.Multi {
			n = len(issues) // single mode counts every searched issue, as it always did
		}
		emit(Done{"done", tag(a.email), n, a.logs, a.secs})
		total += a.secs
	}
	if req.Multi {
		emit(AllDone{"all_done", len(authors), total})
	}
}

func retryMsg(status int, wait time.Duration, retry, of int) string {
	why := "unavailable"
	if status == http.StatusTooManyRequests {
		why = "rate limited"
	}
	return fmt.Sprintf("Jira answered %d (%s); retrying in %d s (retry %d of %d)",
		status, why, int(math.Ceil(wait.Seconds())), retry, of)
}

// notFoundError means no single Jira user matches an email; the run goes on without them.
type notFoundError struct{ msg string }

func (e *notFoundError) Error() string { return e.msg }

type jiraUser struct {
	AccountID   string `json:"accountId"`
	DisplayName string `json:"displayName"`
	Email       string `json:"emailAddress"`
}

func (c *Client) resolveUser(ctx context.Context, user string) (id, name string, err error) {
	if strings.EqualFold(user, c.email) {
		var me jiraUser
		if err := c.get(ctx, "/rest/api/3/myself", url.Values{}, &me); err != nil {
			return "", "", err
		}
		if me.AccountID == "" {
			return "", "", errors.New("jira did not return an account for these credentials")
		}
		return me.AccountID, me.DisplayName, nil
	}
	var found []jiraUser
	if err := c.get(ctx, "/rest/api/3/user/search", url.Values{"query": {user}}, &found); err != nil {
		return "", "", err
	}
	for _, u := range found {
		if strings.EqualFold(u.Email, user) && u.AccountID != "" {
			return u.AccountID, u.DisplayName, nil
		}
	}
	// Jira hides emails of users who asked for it; accept a lone hidden-email hit.
	if len(found) == 1 && found[0].Email == "" && found[0].AccountID != "" {
		return found[0].AccountID, found[0].DisplayName, nil
	}
	if len(found) == 0 {
		return "", "", &notFoundError{"no Jira user found for that email"}
	}
	return "", "", &notFoundError{"could not tell which Jira user matches that email"}
}

type issueRef struct{ Key, Summary string }

func jqlQuote(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}

func (c *Client) searchIssues(ctx context.Context, accts []string, from, to time.Time) ([]issueRef, error) {
	quoted := make([]string, len(accts))
	for i, a := range accts {
		quoted[i] = jqlQuote(a)
	}
	jql := fmt.Sprintf("worklogAuthor in (%s) AND worklogDate >= %s AND worklogDate <= %s",
		strings.Join(quoted, ","), jqlQuote(from.AddDate(0, 0, -1).Format(dateLayout)), jqlQuote(to.AddDate(0, 0, 1).Format(dateLayout)))
	var out []issueRef
	token := ""
	for {
		q := url.Values{"jql": {jql}, "fields": {"summary"}, "maxResults": {"100"}}
		if token != "" {
			q.Set("nextPageToken", token)
		}
		var page struct {
			Issues []struct {
				Key    string `json:"key"`
				Fields struct {
					Summary string `json:"summary"`
				} `json:"fields"`
			} `json:"issues"`
			NextPageToken string `json:"nextPageToken"`
			IsLast        bool   `json:"isLast"`
		}
		if err := c.get(ctx, "/rest/api/3/search/jql", q, &page); err != nil {
			return nil, err
		}
		for _, is := range page.Issues {
			out = append(out, issueRef{is.Key, is.Fields.Summary})
		}
		if page.IsLast || page.NextPageToken == "" {
			return out, nil
		}
		token = page.NextPageToken
	}
}

// worklogs fetches one issue's worklogs once and returns the entries inside
// [start, end) of the tracked authors, per account id, each sorted by start.
// An account id with no entries has no key in the result.
func (c *Client) worklogs(ctx context.Context, key string, tracked map[string][]*author, start, end time.Time, loc *time.Location) (map[string][]Entry, error) {
	// Widen the server-side window by a day each way; the exact filter is done here.
	after := start.AddDate(0, 0, -1).UnixMilli()
	before := end.AddDate(0, 0, 1).UnixMilli()
	type kept struct {
		at   time.Time
		acct string
		e    Entry
	}
	var all []kept
	for startAt := 0; ; {
		q := url.Values{
			"startAt": {strconv.Itoa(startAt)}, "maxResults": {"1000"},
			"startedAfter": {strconv.FormatInt(after, 10)}, "startedBefore": {strconv.FormatInt(before, 10)},
		}
		var page struct {
			Total    int `json:"total"`
			Worklogs []struct {
				Author struct {
					AccountID string `json:"accountId"`
				} `json:"author"`
				Started string `json:"started"`
				Seconds int    `json:"timeSpentSeconds"`
			} `json:"worklogs"`
		}
		if err := c.get(ctx, "/rest/api/3/issue/"+url.PathEscape(key)+"/worklog", q, &page); err != nil {
			return nil, err
		}
		for _, w := range page.Worklogs {
			if _, ok := tracked[w.Author.AccountID]; !ok {
				continue
			}
			t, err := time.Parse("2006-01-02T15:04:05.000-0700", w.Started)
			if err != nil {
				continue
			}
			t = t.In(loc)
			if t.Before(start) || !t.Before(end) {
				continue
			}
			fin := t.Add(time.Duration(w.Seconds) * time.Second)
			all = append(all, kept{t, w.Author.AccountID, Entry{
				Date: t.Format(dateLayout), Start: t.Format("15:04"), End: fin.Format("15:04"),
				EndDayOffset: dayDiff(t, fin), Seconds: w.Seconds,
			}})
		}
		startAt += len(page.Worklogs)
		if len(page.Worklogs) == 0 || startAt >= page.Total {
			break
		}
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].at.Before(all[j].at) })
	out := map[string][]Entry{}
	for _, k := range all {
		out[k.acct] = append(out[k.acct], k.e)
	}
	return out, nil
}

// dayDiff is the number of calendar days between the dates of a and b (same zone).
func dayDiff(a, b time.Time) int {
	ad := time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, time.UTC)
	bd := time.Date(b.Year(), b.Month(), b.Day(), 0, 0, 0, 0, time.UTC)
	return int(bd.Sub(ad).Hours() / 24)
}
