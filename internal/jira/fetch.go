package jira

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const dateLayout = "2006-01-02"

// Stream events (one NDJSON line each).
type (
	Log struct {
		Type string `json:"type"`
		Msg  string `json:"msg"`
	}
	User struct {
		Type        string `json:"type"`
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
		Index    int     `json:"index"`
		Count    int     `json:"count"`
		Key      string  `json:"key"`
		Summary  string  `json:"summary"`
		Seconds  int     `json:"seconds"`
		Worklogs []Entry `json:"worklogs"`
	}
	Error struct {
		Type  string `json:"type"`
		Msg   string `json:"msg"`
		Fatal bool   `json:"fatal"`
	}
	Done struct {
		Type     string `json:"type"`
		Issues   int    `json:"issues"`
		Worklogs int    `json:"worklogs"`
		Seconds  int    `json:"seconds"`
	}
)

// Request is one fetch: who, which days (UTC-midnight dates), in which zone.
type Request struct {
	User string // email of the person whose worklogs are wanted
	From time.Time
	To   time.Time
	Loc  *time.Location
}

// Fetch resolves the user, finds the issues with their worklogs in the (widened)
// range, then fetches each issue's worklogs sequentially, calling emit per event.
// It stops quietly when ctx ends. It always ends with Done or a fatal Error.
func (c *Client) Fetch(ctx context.Context, req Request, emit func(any)) {
	fatal := func(err error) {
		if ctx.Err() == nil {
			emit(Error{Type: "error", Msg: err.Error(), Fatal: true})
		}
	}
	emit(Log{"log", "Looking up the Jira user"})
	acct, name, err := c.resolveUser(ctx, req.User)
	if err != nil {
		fatal(err)
		return
	}
	emit(User{"user", name})

	emit(Log{"log", "Searching issues with worklogs"})
	issues, err := c.searchIssues(ctx, acct, req.From, req.To)
	if err != nil {
		fatal(err)
		return
	}
	emit(Issues{"issues", len(issues)})

	rangeStart := time.Date(req.From.Year(), req.From.Month(), req.From.Day(), 0, 0, 0, 0, req.Loc)
	rangeEnd := time.Date(req.To.Year(), req.To.Month(), req.To.Day()+1, 0, 0, 0, 0, req.Loc)
	var totalLogs, totalSecs int
	for i, is := range issues {
		if ctx.Err() != nil {
			return
		}
		entries, err := c.worklogs(ctx, is.Key, acct, rangeStart, rangeEnd, req.Loc)
		if err != nil {
			var he *HTTPError
			fatalErr := errors.As(err, &he) && he.Auth()
			if ctx.Err() == nil {
				emit(Error{"error", fmt.Sprintf("%s: %v", is.Key, err), fatalErr})
			}
			if fatalErr || ctx.Err() != nil {
				return
			}
			continue
		}
		secs := 0
		for _, e := range entries {
			secs += e.Seconds
		}
		totalLogs += len(entries)
		totalSecs += secs
		emit(Issue{"issue", i + 1, len(issues), is.Key, is.Summary, secs, entries})
	}
	emit(Done{"done", len(issues), totalLogs, totalSecs})
}

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
		return "", "", errors.New("no Jira user found for that email")
	}
	return "", "", errors.New("could not tell which Jira user matches that email")
}

type issueRef struct{ Key, Summary string }

func jqlQuote(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}

func (c *Client) searchIssues(ctx context.Context, acct string, from, to time.Time) ([]issueRef, error) {
	jql := fmt.Sprintf("worklogAuthor = %s AND worklogDate >= %s AND worklogDate <= %s",
		jqlQuote(acct), jqlQuote(from.AddDate(0, 0, -1).Format(dateLayout)), jqlQuote(to.AddDate(0, 0, 1).Format(dateLayout)))
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

func (c *Client) worklogs(ctx context.Context, key, acct string, start, end time.Time, loc *time.Location) ([]Entry, error) {
	// Widen the server-side window by a day each way; the exact filter is done here.
	after := start.AddDate(0, 0, -1).UnixMilli()
	before := end.AddDate(0, 0, 1).UnixMilli()
	entries := []Entry{}
	type kept struct {
		at time.Time
		e  Entry
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
			if w.Author.AccountID != acct {
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
			all = append(all, kept{t, Entry{
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
	for _, k := range all {
		entries = append(entries, k.e)
	}
	return entries, nil
}

// dayDiff is the number of calendar days between the dates of a and b (same zone).
func dayDiff(a, b time.Time) int {
	ad := time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, time.UTC)
	bd := time.Date(b.Year(), b.Month(), b.Day(), 0, 0, 0, 0, time.UTC)
	return int(bd.Sub(ad).Hours() / 24)
}
