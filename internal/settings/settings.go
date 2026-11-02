// Package settings holds the saved Jira connection settings and their validation.
package settings

import (
	"net/url"
	"strings"
	"time"
)

// MaxRangeDays is the longest FROM..TO range (inclusive) one fetch may cover.
const MaxRangeDays = 366

const dateLayout = "2006-01-02"

// Settings are the connection settings the UI saves and sends. Dates are never part of them.
type Settings struct {
	JiraDomain string `json:"jira_domain"`
	User       string `json:"user"`
	APIEmail   string `json:"api_email"`
	SameAsUser bool   `json:"same_as_user"`
	APIToken   string `json:"api_token"`
	Timezone   string `json:"timezone"`
	// Users are the people the multi-user page fetches (lowercase emails, at most MaxUsers).
	Users []string `json:"users"`
}

// MaxUsers is the most users one multi-user fetch may cover (the JQL stays in the GET URL).
const MaxUsers = 50

// invalid is an error whose text is shown to the user as is.
type invalid string

func (e invalid) Error() string { return string(e) }

// Default is what GET /api/settings returns before anything was saved.
func Default() Settings {
	return Settings{SameAsUser: true, Timezone: "Etc/UTC", Users: []string{}}
}

// Validate checks s and returns the normalised copy (domain trimmed to scheme+host,
// api_email mirrored from user when same_as_user) plus the parsed time zone.
func (s Settings) Validate() (Settings, *time.Location, error) {
	domain, err := normaliseDomain(s.JiraDomain)
	if err != nil {
		return Settings{}, nil, err
	}
	s.JiraDomain = domain
	s.User = strings.TrimSpace(s.User)
	s.APIEmail = strings.TrimSpace(s.APIEmail)
	s.APIToken = strings.TrimSpace(s.APIToken)
	switch {
	case s.SameAsUser && !strings.Contains(s.User, "@"):
		return Settings{}, nil, invalid("User must be an email address.")
	case s.User != "" && !strings.Contains(s.User, "@"):
		return Settings{}, nil, invalid("User must be an email address.")
	}
	if s.Users, err = NormaliseUsers(s.Users); err != nil {
		return Settings{}, nil, err
	}
	if s.SameAsUser {
		s.APIEmail = s.User
	} else if !strings.Contains(s.APIEmail, "@") {
		return Settings{}, nil, invalid("API email must be an email address.")
	}
	if s.APIToken == "" {
		return Settings{}, nil, invalid("API token is required.")
	}
	if s.Timezone == "" || s.Timezone == "Local" {
		return Settings{}, nil, invalid("Unknown time zone.")
	}
	loc, err := time.LoadLocation(s.Timezone)
	if err != nil {
		return Settings{}, nil, invalid("Unknown time zone.")
	}
	return s, loc, nil
}

// NormaliseUsers trims, lowercases, drops empty entries and duplicates (keeping
// the first occurrence's order) and checks each is an email and there are at
// most MaxUsers. The result is never nil.
func NormaliseUsers(in []string) ([]string, error) {
	out := make([]string, 0, len(in))
	seen := map[string]bool{}
	for _, u := range in {
		u = strings.ToLower(strings.TrimSpace(u))
		if u == "" || seen[u] {
			continue
		}
		if !strings.Contains(u, "@") {
			return nil, invalid("Each user must be an email address.")
		}
		seen[u] = true
		out = append(out, u)
	}
	if len(out) > MaxUsers {
		return nil, invalid("At most 50 users.")
	}
	return out, nil
}

// normaliseDomain accepts only https://<sub>.atlassian.net (any path is dropped).
func normaliseDomain(raw string) (string, error) {
	bad := invalid("Jira domain must look like https://<name>.atlassian.net.")
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return "", bad
	}
	host := strings.ToLower(u.Hostname())
	sub, ok := strings.CutSuffix(host, ".atlassian.net")
	if !ok || sub == "" || strings.Contains(sub, ".") {
		return "", bad
	}
	for _, c := range sub {
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
			return "", bad
		}
	}
	return "https://" + host, nil
}

// ParseRange parses FROM and TO (YYYY-MM-DD, as UTC midnights) and checks
// FROM <= TO and at most MaxRangeDays days inclusive.
func ParseRange(from, to string) (time.Time, time.Time, error) {
	f, err1 := time.Parse(dateLayout, from)
	t, err2 := time.Parse(dateLayout, to)
	if err1 != nil || err2 != nil {
		return time.Time{}, time.Time{}, invalid("Dates must be YYYY-MM-DD.")
	}
	if t.Before(f) {
		return time.Time{}, time.Time{}, invalid("FROM must not be after TO.")
	}
	if int(t.Sub(f).Hours()/24)+1 > MaxRangeDays {
		return time.Time{}, time.Time{}, invalid("The range may cover at most 366 days.")
	}
	return f, t, nil
}
