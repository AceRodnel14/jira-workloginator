package settings

import (
	"fmt"
	"reflect"
	"testing"
)

func valid() Settings {
	return Settings{JiraDomain: "https://acme.atlassian.net", User: "a@b.c", SameAsUser: true, APIToken: "t", Timezone: "Asia/Manila"}
}

func TestValidate(t *testing.T) {
	for name, tt := range map[string]struct {
		mod    func(*Settings)
		ok     bool
		domain string
	}{
		"valid":           {func(*Settings) {}, true, "https://acme.atlassian.net"},
		"trims path":      {func(s *Settings) { s.JiraDomain = "https://Acme.atlassian.net/jira/x?y=1" }, true, "https://acme.atlassian.net"},
		"http":            {func(s *Settings) { s.JiraDomain = "http://acme.atlassian.net" }, false, ""},
		"other domain":    {func(s *Settings) { s.JiraDomain = "https://example.com" }, false, ""},
		"suffix trick":    {func(s *Settings) { s.JiraDomain = "https://acme.atlassian.net.evil.com" }, false, ""},
		"nested sub":      {func(s *Settings) { s.JiraDomain = "https://a.b.atlassian.net" }, false, ""},
		"bare atlassian":  {func(s *Settings) { s.JiraDomain = "https://atlassian.net" }, false, ""},
		"userinfo":        {func(s *Settings) { s.JiraDomain = "https://x@acme.atlassian.net" }, false, ""},
		"port":            {func(s *Settings) { s.JiraDomain = "https://acme.atlassian.net:8443" }, false, ""},
		"user no at":      {func(s *Settings) { s.User = "nobody" }, false, ""},
		"user optional":   {func(s *Settings) { s.SameAsUser = false; s.User = ""; s.APIEmail = "x@y.z" }, true, "https://acme.atlassian.net"},
		"user bad, free":  {func(s *Settings) { s.SameAsUser = false; s.User = "nobody"; s.APIEmail = "x@y.z" }, false, ""},
		"same needs user": {func(s *Settings) { s.User = "" }, false, ""},
		"email no at":     {func(s *Settings) { s.SameAsUser = false; s.APIEmail = "x" }, false, ""},
		"separate email":  {func(s *Settings) { s.SameAsUser = false; s.APIEmail = "x@y.z" }, true, "https://acme.atlassian.net"},
		"empty token":     {func(s *Settings) { s.APIToken = " " }, false, ""},
		"bad tz":          {func(s *Settings) { s.Timezone = "Mars/Base" }, false, ""},
		"empty tz":        {func(s *Settings) { s.Timezone = "" }, false, ""},
	} {
		t.Run(name, func(t *testing.T) {
			s := valid()
			tt.mod(&s)
			got, loc, err := s.Validate()
			if (err == nil) != tt.ok {
				t.Fatalf("err = %v, want ok=%v", err, tt.ok)
			}
			if tt.ok && (got.JiraDomain != tt.domain || loc == nil) {
				t.Errorf("got %+v", got)
			}
		})
	}
	s := valid()
	got, _, _ := s.Validate()
	if got.APIEmail != "a@b.c" {
		t.Errorf("same_as_user must mirror: %q", got.APIEmail)
	}
}

func TestParseRange(t *testing.T) {
	for name, tt := range map[string]struct {
		from, to string
		ok       bool
	}{
		"one day":    {"2026-10-01", "2026-10-01", true},
		"month":      {"2026-10-01", "2026-10-31", true},
		"366 days":   {"2024-01-01", "2024-12-31", true},
		"367 days":   {"2024-01-01", "2025-01-01", false},
		"reversed":   {"2026-10-02", "2026-10-01", false},
		"bad format": {"2026-1-1", "2026-10-01", false},
		"junk":       {"x", "y", false},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := ParseRange(tt.from, tt.to); (err == nil) != tt.ok {
				t.Errorf("err = %v", err)
			}
		})
	}
}

func TestValidateUsers(t *testing.T) {
	many := func(n int) []string {
		var u []string
		for i := range n {
			u = append(u, fmt.Sprintf("u%d@x.io", i))
		}
		return u
	}
	s := valid()
	s.Users = []string{" Bob@X.io ", "", "bob@x.io", "AL@x.io", "  "}
	got, _, err := s.Validate()
	if err != nil || !reflect.DeepEqual(got.Users, []string{"bob@x.io", "al@x.io"}) {
		t.Errorf("normalise: %v %v", got.Users, err)
	}
	s.Users = nil
	if got, _, err := s.Validate(); err != nil || got.Users == nil || len(got.Users) != 0 {
		t.Errorf("empty must be [] not nil: %#v %v", got.Users, err)
	}
	s.Users = []string{"nobody"}
	if _, _, err := s.Validate(); err == nil {
		t.Error("user without @ accepted")
	}
	s.Users = many(50)
	if _, _, err := s.Validate(); err != nil {
		t.Errorf("50 users: %v", err)
	}
	s.Users = many(51)
	if _, _, err := s.Validate(); err == nil || err.Error() != "At most 50 users." {
		t.Errorf("51 users: %v", err)
	}
	if d := Default(); d.Users == nil {
		t.Error("Default users must be [] not nil")
	}
}
