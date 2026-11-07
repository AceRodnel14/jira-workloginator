package server

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"gitlab.com/acerodnel/jira-workloginator/internal/jira"
	"gitlab.com/acerodnel/jira-workloginator/internal/settings"
	"gitlab.com/acerodnel/jira-workloginator/internal/store"
)

func TestMain(m *testing.M) {
	kdfIterations = 1000 // production uses 600k; keep tests fast
	os.Exit(m.Run())
}

func testConfig(t *testing.T, env map[string]string) Config {
	t.Helper()
	cfg, err := LoadConfig(func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	cfg.JSONPath = filepath.Join(t.TempDir(), "config.json")
	return cfg
}

func newServer(t *testing.T, env map[string]string, opts ...Option) (*Server, Config) {
	t.Helper()
	cfg := testConfig(t, env)
	s, err := New(cfg, nil, store.NewJSON(cfg.JSONPath), opts...)
	if err != nil {
		t.Fatal(err)
	}
	return s, cfg
}

type reqOpt func(*http.Request)

func do(h http.Handler, method, path, body string, opts ...reqOpt) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	r.RemoteAddr = "192.0.2.1:5555"
	for _, o := range opts {
		o(r)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func withCookie(c *http.Cookie) reqOpt { return func(r *http.Request) { r.AddCookie(c) } }
func withHeader(k, v string) reqOpt    { return func(r *http.Request) { r.Header.Set(k, v) } }

func TestLoadConfig(t *testing.T) {
	for name, tt := range map[string]struct {
		env     map[string]string
		wantErr string
	}{
		"defaults":        {nil, ""},
		"postgres":        {map[string]string{"STORAGE": "postgres", "DATABASE_URL": "postgres://x"}, ""},
		"bad storage":     {map[string]string{"STORAGE": "mysql"}, "STORAGE"},
		"bad level":       {map[string]string{"LOG_LEVEL": "loud"}, "LOG_LEVEL"},
		"postgres no url": {map[string]string{"STORAGE": "postgres"}, ""}, // allowed: /readyz stays 503
	} {
		t.Run(name, func(t *testing.T) {
			cfg, err := LoadConfig(func(k string) string { return tt.env[k] })
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("err = %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if name == "defaults" && (cfg.Port != "8080" || cfg.BaseURL != "http://localhost:8080" || cfg.Storage != "json" || cfg.JSONPath != "/data/config.json") {
				t.Errorf("defaults: %+v", cfg)
			}
		})
	}
}

func TestHealthAndReady(t *testing.T) {
	s, _ := newServer(t, nil)
	for _, p := range []string{"/healthz", "/readyz"} {
		if rec := do(s, "GET", p, ""); rec.Code != 200 {
			t.Errorf("%s: %d", p, rec.Code)
		}
	}
	cfg := testConfig(t, map[string]string{"STORAGE": "postgres", "DATABASE_URL": "postgres://nobody@127.0.0.1:1/x"})
	bad, err := New(cfg, nil, store.NewPostgres(cfg.DatabaseURL))
	if err != nil {
		t.Fatal(err)
	}
	if rec := do(bad, "GET", "/healthz", ""); rec.Code != 200 {
		t.Errorf("healthz with bad db: %d", rec.Code)
	}
	if rec := do(bad, "GET", "/readyz", ""); rec.Code != 503 {
		t.Errorf("readyz with bad db: %d", rec.Code)
	}
	if rec := do(bad, "GET", "/api/settings", ""); rec.Code != 503 {
		t.Errorf("settings with bad db: %d", rec.Code)
	}
}

func TestInfoAndSPA(t *testing.T) {
	cfg := testConfig(t, map[string]string{"BASE_URL": "https://app.example.com", "LOGIN_PASS": "pw"})
	static := fstest.MapFS{"index.html": {Data: []byte("<h1>app</h1>")}, "app.js": {Data: []byte("js")}}
	s, err := New(cfg, static, store.NewJSON(cfg.JSONPath))
	if err != nil {
		t.Fatal(err)
	}
	rec := do(s, "GET", "/api/info", "") // public even with LOGIN_PASS
	var got map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil || got["base_url"] != "https://app.example.com" {
		t.Errorf("info: %d %v %v", rec.Code, got, err)
	}
	for path, want := range map[string]string{"/": "<h1>app</h1>", "/x/y": "<h1>app</h1>", "/app.js": "js"} {
		rec := do(s, "GET", path, "")
		if rec.Code != 200 || rec.Body.String() != want {
			t.Errorf("%s: %d %q", path, rec.Code, rec.Body.String())
		}
	}
}

const validSettings = `{"jira_domain":"https://acme.atlassian.net","user":"a@b.c","api_email":"","same_as_user":true,"api_token":"tok","timezone":"Asia/Manila"}`

func TestNoLoginOpen(t *testing.T) {
	s, _ := newServer(t, nil)
	var sess map[string]bool
	_ = json.NewDecoder(do(s, "GET", "/api/session", "").Body).Decode(&sess)
	if sess["login_required"] || !sess["authenticated"] {
		t.Errorf("session: %v", sess)
	}
	if rec := do(s, "GET", "/api/settings", ""); rec.Code != 200 {
		t.Errorf("settings: %d", rec.Code)
	}
	if rec := do(s, "POST", "/api/login", `{"password":"x"}`); rec.Code != 404 {
		t.Errorf("login without LOGIN_PASS: %d", rec.Code)
	}
	if rec := do(s, "POST", "/api/logout", ""); rec.Code != 204 {
		t.Errorf("logout: %d", rec.Code)
	}
}

func login(t *testing.T, s *Server) *http.Cookie {
	t.Helper()
	rec := do(s, "POST", "/api/login", `{"password":"hunter2"}`)
	if rec.Code != 204 {
		t.Fatalf("login: %d %s", rec.Code, rec.Body)
	}
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookie {
			return c
		}
	}
	t.Fatal("no cookie")
	return nil
}

func TestAuthFlow(t *testing.T) {
	s, _ := newServer(t, map[string]string{"LOGIN_PASS": "hunter2", "BASE_URL": "https://app.example.com"})
	if rec := do(s, "GET", "/api/settings", ""); rec.Code != 401 {
		t.Errorf("no cookie: %d", rec.Code)
	}
	if rec := do(s, "POST", "/api/worklogs", validSettings); rec.Code != 401 {
		t.Errorf("worklogs no cookie: %d", rec.Code)
	}
	if rec := do(s, "GET", "/healthz", ""); rec.Code != 200 {
		t.Errorf("healthz: %d", rec.Code)
	}
	var sess map[string]bool
	_ = json.NewDecoder(do(s, "GET", "/api/session", "").Body).Decode(&sess)
	if !sess["login_required"] || sess["authenticated"] {
		t.Errorf("session before login: %v", sess)
	}

	if rec := do(s, "POST", "/api/login", `{"password":"wrong"}`); rec.Code != 401 {
		t.Errorf("wrong pw: %d", rec.Code)
	}
	c := login(t, s)
	if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode || c.Path != "/" || c.MaxAge != 12*3600 {
		t.Errorf("cookie attrs: %+v", c)
	}
	if rec := do(s, "GET", "/api/settings", "", withCookie(c)); rec.Code != 200 {
		t.Errorf("with cookie: %d", rec.Code)
	}
	sess = nil
	_ = json.NewDecoder(do(s, "GET", "/api/session", "", withCookie(c)).Body).Decode(&sess)
	if !sess["authenticated"] {
		t.Errorf("session after login: %v", sess)
	}

	// tampered: change the first character (it carries the expiry bytes)
	bad := *c
	repl := "A"
	if bad.Value[0] == 'A' {
		repl = "B"
	}
	bad.Value = repl + bad.Value[1:]
	if rec := do(s, "GET", "/api/settings", "", withCookie(&bad)); rec.Code != 401 {
		t.Errorf("tampered: %d", rec.Code)
	}
	if rec := do(s, "GET", "/api/settings", "", withCookie(&http.Cookie{Name: sessionCookie, Value: "!!!"})); rec.Code != 401 {
		t.Errorf("garbage: %d", rec.Code)
	}

	// expired (and a cookie signed with another password)
	s.auth.now = func() time.Time { return time.Now().Add(13 * time.Hour) }
	if rec := do(s, "GET", "/api/settings", "", withCookie(c)); rec.Code != 401 {
		t.Errorf("expired: %d", rec.Code)
	}
	s.auth.now = time.Now
	other, _ := newServer(t, map[string]string{"LOGIN_PASS": "different"})
	if rec := do(other, "GET", "/api/settings", "", withCookie(c)); rec.Code != 401 {
		t.Errorf("cookie from other password: %d", rec.Code)
	}

	// logout clears the cookie
	rec := do(s, "POST", "/api/logout", "", withCookie(c))
	if rec.Code != 204 {
		t.Fatalf("logout: %d", rec.Code)
	}
	cleared := false
	for _, ck := range rec.Result().Cookies() {
		if ck.Name == sessionCookie && ck.MaxAge < 0 && ck.Value == "" {
			cleared = true
		}
	}
	if !cleared {
		t.Error("logout did not clear the cookie")
	}
}

func TestCookieNotSecureOnHTTP(t *testing.T) {
	s, _ := newServer(t, map[string]string{"LOGIN_PASS": "hunter2"})
	if c := login(t, s); c.Secure {
		t.Error("Secure set for http BASE_URL")
	}
}

func TestLoginRateLimit(t *testing.T) {
	s, _ := newServer(t, map[string]string{"LOGIN_PASS": "hunter2"})
	for i := range 10 {
		if rec := do(s, "POST", "/api/login", `{"password":"nope"}`); rec.Code != 401 {
			t.Fatalf("attempt %d: %d", i, rec.Code)
		}
	}
	if rec := do(s, "POST", "/api/login", `{"password":"hunter2"}`); rec.Code != 429 {
		t.Errorf("11th attempt (even correct): %d", rec.Code)
	}
	// another peer is unaffected
	rec := do(s, "POST", "/api/login", `{"password":"hunter2"}`, func(r *http.Request) { r.RemoteAddr = "192.0.2.9:1" })
	if rec.Code != 204 {
		t.Errorf("other peer: %d", rec.Code)
	}
	// X-Forwarded-For is never trusted
	if rec := do(s, "POST", "/api/login", `{"password":"hunter2"}`, withHeader("X-Forwarded-For", "203.0.113.5")); rec.Code != 429 {
		t.Errorf("xff bypass: %d", rec.Code)
	}
}

func TestSuccessfulLoginsDoNotExhaustLimiter(t *testing.T) {
	s, _ := newServer(t, map[string]string{"LOGIN_PASS": "hunter2"})
	for range 15 {
		login(t, s)
	}
}

func TestCrossOriginRejected(t *testing.T) {
	s, _ := newServer(t, map[string]string{"BASE_URL": "https://app.example.com"})
	for name, tt := range map[string]struct {
		opts []reqOpt
		want int
	}{
		"evil origin":      {[]reqOpt{withHeader("Origin", "https://evil.example")}, 403},
		"cross-site fetch": {[]reqOpt{withHeader("Sec-Fetch-Site", "cross-site")}, 403},
		"same host origin": {[]reqOpt{withHeader("Origin", "http://example.com")}, 204}, // httptest Host is example.com
		"base url origin":  {[]reqOpt{withHeader("Origin", "https://app.example.com")}, 204},
		"no origin (curl)": {nil, 204},
	} {
		t.Run(name, func(t *testing.T) {
			if rec := do(s, "PUT", "/api/settings", validSettings, tt.opts...); rec.Code != tt.want {
				t.Errorf("%d: %s", rec.Code, rec.Body)
			}
		})
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	s, cfg := newServer(t, nil)
	var def settings.Settings
	_ = json.NewDecoder(do(s, "GET", "/api/settings", "").Body).Decode(&def)
	if !reflect.DeepEqual(def, settings.Default()) {
		t.Errorf("defaults: %+v", def)
	}
	// dates in the body are ignored, domain is trimmed, email mirrored
	body := strings.Replace(validSettings, `"timezone"`, `"from":"2026-10-01","to":"2026-10-31","timezone"`, 1)
	body = strings.Replace(body, "atlassian.net", "atlassian.net/jira", 1)
	if rec := do(s, "PUT", "/api/settings", body); rec.Code != 204 {
		t.Fatalf("put: %d %s", rec.Code, rec.Body)
	}
	rec := do(s, "GET", "/api/settings", "")
	if strings.Contains(rec.Body.String(), "from") {
		t.Errorf("dates saved: %s", rec.Body)
	}
	var got settings.Settings
	_ = json.NewDecoder(rec.Body).Decode(&got)
	want := settings.Settings{JiraDomain: "https://acme.atlassian.net", User: "a@b.c", APIEmail: "a@b.c", SameAsUser: true, APIToken: "tok", Timezone: "Asia/Manila", Users: []string{}, WorkHours: 8}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v", got)
	}
	info, err := os.Stat(cfg.JSONPath)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("file: %v %v", info, err)
	}
}

func TestSettingsValidation(t *testing.T) {
	s, _ := newServer(t, nil)
	for name, body := range map[string]string{
		"http":          strings.Replace(validSettings, "https://acme", "http://acme", 1),
		"not atlassian": strings.Replace(validSettings, "acme.atlassian.net", "jira.example.com", 1),
		"user no @":     strings.Replace(validSettings, `"a@b.c"`, `"abc"`, 1),
		"email no @":    strings.Replace(strings.Replace(validSettings, `"same_as_user":true`, `"same_as_user":false`, 1), `"api_email":""`, `"api_email":"x"`, 1),
		"empty token":   strings.Replace(validSettings, `"tok"`, `""`, 1),
		"bad tz":        strings.Replace(validSettings, "Asia/Manila", "Mars/Base", 1),
		"bad json":      `{`,
	} {
		t.Run(name, func(t *testing.T) {
			rec := do(s, "PUT", "/api/settings", body)
			if rec.Code != 400 {
				t.Fatalf("%d", rec.Code)
			}
			var e map[string]string
			if err := json.NewDecoder(rec.Body).Decode(&e); err != nil || e["error"] == "" {
				t.Errorf("error body: %v %v", e, err)
			}
		})
	}
	if rec := do(s, "PUT", "/api/settings", validSettings, withHeader("Content-Type", "text/plain")); rec.Code != 415 {
		t.Errorf("content type: %d", rec.Code)
	}
	big := `{"api_token":"` + strings.Repeat("x", 70<<10) + `"}`
	if rec := do(s, "PUT", "/api/settings", big); rec.Code != 400 || !strings.Contains(rec.Body.String(), "too large") {
		t.Errorf("big body: %d %s", rec.Code, rec.Body)
	}
}

func TestSettingsStoreFailure(t *testing.T) {
	cfg := testConfig(t, nil)
	cfg.JSONPath = filepath.Join(t.TempDir(), "file", "sub", "config.json")
	if err := os.WriteFile(filepath.Dir(filepath.Dir(cfg.JSONPath)), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	s, _ := New(cfg, nil, store.NewJSON(cfg.JSONPath))
	rec := do(s, "PUT", "/api/settings", validSettings)
	if rec.Code != 500 || strings.Contains(rec.Body.String(), cfg.JSONPath) {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
}

// ---- worklogs streaming against a fake Jira ----

// fakeJira serves the Jira endpoints over TLS; the returned client dials it for any host.
func fakeJira(t *testing.T, h http.HandlerFunc) *http.Client {
	t.Helper()
	srv := httptest.NewTLSServer(h)
	t.Cleanup(srv.Close)
	addr := srv.Listener.Addr().String()
	hc := jira.NewHTTPClient()
	hc.Transport = &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // test server certificate
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, addr)
		},
	}
	return hc
}

func jsonOut(w http.ResponseWriter, v any) { _ = json.NewEncoder(w).Encode(v) }

func happyJira(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/rest/api/3/myself":
		jsonOut(w, map[string]string{"accountId": "acc1", "displayName": "Me"})
	case "/rest/api/3/search/jql":
		jsonOut(w, map[string]any{"issues": []any{map[string]any{"key": "A-1", "fields": map[string]string{"summary": "One"}}}, "isLast": true})
	default:
		jsonOut(w, map[string]any{"total": 1, "worklogs": []any{map[string]any{
			"author": map[string]string{"accountId": "acc1"}, "started": "2026-10-01T09:00:00.000+0000", "timeSpentSeconds": 5400}}})
	}
}

const worklogBody = `{"jira_domain":"https://acme.atlassian.net","user":"a@b.c","same_as_user":true,"api_token":"SECRET-TOKEN","timezone":"Etc/UTC","from":"2026-10-01","to":"2026-10-31"}`

func TestWorklogsStream(t *testing.T) {
	s, _ := newServer(t, nil, WithJiraClient(fakeJira(t, happyJira)))
	rec := do(s, "POST", "/api/worklogs", worklogBody)
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/x-ndjson" ||
		rec.Header().Get("Cache-Control") != "no-store" || rec.Header().Get("X-Accel-Buffering") != "no" {
		t.Fatalf("%d %v", rec.Code, rec.Header())
	}
	var types []string
	var lastLine map[string]any
	sc := bufio.NewScanner(rec.Body)
	for sc.Scan() {
		var m map[string]any
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			t.Fatalf("invalid NDJSON line %q: %v", sc.Text(), err)
		}
		types = append(types, m["type"].(string))
		lastLine = m
	}
	if strings.Join(types, ",") != "log,user,log,issues,issue,done" {
		t.Errorf("types: %v", types)
	}
	if lastLine["issues"] != 1.0 || lastLine["worklogs"] != 1.0 || lastLine["seconds"] != 5400.0 {
		t.Errorf("done: %v", lastLine)
	}
	if strings.Contains(rec.Body.String(), "SECRET-TOKEN") {
		t.Error("token in stream")
	}
}

func TestWorklogsDoesNotReadStore(t *testing.T) {
	s, cfg := newServer(t, nil, WithJiraClient(fakeJira(t, happyJira)))
	do(s, "POST", "/api/worklogs", worklogBody)
	if _, err := os.Stat(cfg.JSONPath); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("worklogs must not save settings: %v", err)
	}
}

func TestWorklogsValidation(t *testing.T) {
	calls := 0
	s, _ := newServer(t, nil, WithJiraClient(fakeJira(t, func(http.ResponseWriter, *http.Request) { calls++ })))
	for name, body := range map[string]string{
		"non-atlassian": strings.Replace(worklogBody, "acme.atlassian.net", "jira.example.com", 1),
		"http":          strings.Replace(worklogBody, "https://acme", "http://acme", 1),
		"from > to":     strings.Replace(worklogBody, `"2026-10-01"`, `"2026-11-01"`, 1),
		"367 days":      strings.Replace(strings.Replace(worklogBody, `"2026-10-01"`, `"2025-10-01"`, 1), `"2026-10-31"`, `"2026-10-02"`, 1),
		"bad date":      strings.Replace(worklogBody, "2026-10-01", "yesterday", 1),
		"JQL injection": strings.Replace(worklogBody, "2026-10-01", `2026-10-01" OR x = "`, 1),
		"empty token":   strings.Replace(worklogBody, "SECRET-TOKEN", "", 1),
		"bad tz":        strings.Replace(worklogBody, "Etc/UTC", "Nope/Zone", 1),
	} {
		t.Run(name, func(t *testing.T) {
			rec := do(s, "POST", "/api/worklogs", body)
			if rec.Code != 400 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
				t.Errorf("%d %s", rec.Code, rec.Body)
			}
		})
	}
	ok := strings.Replace(strings.Replace(worklogBody, `"2026-10-01"`, `"2025-10-31"`, 1), `"2026-10-31"`, `"2026-10-30"`, 1) // exactly 366 days
	if rec := do(s, "POST", "/api/worklogs", ok); rec.Code != 200 {
		t.Errorf("366 days: %d %s", rec.Code, rec.Body)
	}
	if calls == 0 {
		t.Error("valid request never reached Jira")
	}
}

func TestWorklogsJira401(t *testing.T) {
	s, _ := newServer(t, nil, WithJiraClient(fakeJira(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"errorMessages":["Basic auth failed"]}`))
	})))
	rec := do(s, "POST", "/api/worklogs", worklogBody)
	lines := strings.Split(strings.TrimSpace(rec.Body.String()), "\n")
	var last map[string]any
	_ = json.Unmarshal([]byte(lines[len(lines)-1]), &last)
	if last["type"] != "error" || last["fatal"] != true || strings.Contains(rec.Body.String(), "SECRET-TOKEN") {
		t.Errorf("%s", rec.Body)
	}
}

func TestWorklogsCancelStopsFetch(t *testing.T) {
	started := make(chan struct{})
	calls := 0
	hc := fakeJira(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path == "/rest/api/3/myself" {
			close(started)
			<-r.Context().Done() // hang until the client goes away
		}
	})
	s, _ := newServer(t, nil, WithJiraClient(hc))
	ts := httptest.NewServer(s)
	defer ts.Close()

	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, ts.URL+"/api/worklogs", strings.NewReader(worklogBody))
	req.Header.Set("Content-Type", "application/json")
	done := make(chan struct{})
	go func() {
		defer close(done)
		if resp, err := ts.Client().Do(req); err == nil {
			_, _ = io.Copy(io.Discard, resp.Body) // streams until the request context is cancelled
			_ = resp.Body.Close()
		}
	}()
	<-started
	cancel()
	<-done
	time.Sleep(100 * time.Millisecond)
	if calls != 1 {
		t.Errorf("jira calls: %d", calls)
	}
}

// ---- multi-user page and endpoint ----

const multiBody = `{"jira_domain":"https://acme.atlassian.net","api_email":"me@x.io","api_token":"SECRET-TOKEN","timezone":"Etc/UTC","users":["Ann@x.io","bob@x.io"],"from":"2026-10-01","to":"2026-10-31"}`

func multiJira(w http.ResponseWriter, r *http.Request) {
	switch {
	case strings.HasSuffix(r.URL.Path, "/user/search"):
		q := r.URL.Query().Get("query")
		jsonOut(w, []map[string]string{{"accountId": "id-" + q[:3], "displayName": q, "emailAddress": q}})
	case strings.HasSuffix(r.URL.Path, "/search/jql"):
		jsonOut(w, map[string]any{"issues": []any{map[string]any{"key": "A-1", "fields": map[string]string{"summary": "One"}}}, "isLast": true})
	default:
		jsonOut(w, map[string]any{"total": 2, "worklogs": []any{
			map[string]any{"author": map[string]string{"accountId": "id-ann"}, "started": "2026-10-01T09:00:00.000+0000", "timeSpentSeconds": 3600},
			map[string]any{"author": map[string]string{"accountId": "id-bob"}, "started": "2026-10-01T09:00:00.000+0000", "timeSpentSeconds": 1800}}})
	}
}

func TestMultiPageServedBySPA(t *testing.T) {
	cfg := testConfig(t, nil)
	static := fstest.MapFS{"index.html": {Data: []byte("<h1>app</h1>")}}
	s, err := New(cfg, static, store.NewJSON(cfg.JSONPath))
	if err != nil {
		t.Fatal(err)
	}
	if rec := do(s, "GET", "/multiple", ""); rec.Code != 200 || rec.Body.String() != "<h1>app</h1>" {
		t.Errorf("/multiple: %d %q", rec.Code, rec.Body)
	}
	rec := do(s, "GET", "/api/x", "")
	if rec.Code != 404 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
		t.Errorf("/api/x: %d %v", rec.Code, rec.Header())
	}
}

func TestSettingsUsers(t *testing.T) {
	s, _ := newServer(t, nil)
	if rec := do(s, "GET", "/api/settings", ""); !strings.Contains(rec.Body.String(), `"users":[]`) {
		t.Errorf("default users: %s", rec.Body)
	}
	body := strings.Replace(validSettings, `"timezone"`, `"users":[" Ann@X.io ","ann@x.io",""],"timezone"`, 1)
	if rec := do(s, "PUT", "/api/settings", body); rec.Code != 204 {
		t.Fatalf("put: %d %s", rec.Code, rec.Body)
	}
	if rec := do(s, "GET", "/api/settings", ""); !strings.Contains(rec.Body.String(), `"users":["ann@x.io"]`) {
		t.Errorf("saved users: %s", rec.Body)
	}
	bad := strings.Replace(validSettings, `"timezone"`, `"users":["nope"],"timezone"`, 1)
	if rec := do(s, "PUT", "/api/settings", bad); rec.Code != 400 {
		t.Errorf("bad user: %d", rec.Code)
	}
}

func TestWorklogsSingleStillNeedsUser(t *testing.T) {
	s, _ := newServer(t, nil, WithJiraClient(fakeJira(t, happyJira)))
	body := strings.Replace(worklogBody, `"user":"a@b.c","same_as_user":true`, `"user":"","same_as_user":false,"api_email":"a@b.c"`, 1)
	if rec := do(s, "POST", "/api/worklogs", body); rec.Code != 400 {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
}

func TestMultiStream(t *testing.T) {
	s, _ := newServer(t, nil, WithJiraClient(fakeJira(t, multiJira)))
	rec := do(s, "POST", "/api/worklogs/multi", multiBody)
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/x-ndjson" {
		t.Fatalf("%d %v", rec.Code, rec.Header())
	}
	var types []string
	var lastLine map[string]any
	sc := bufio.NewScanner(rec.Body)
	for sc.Scan() {
		var m map[string]any
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			t.Fatalf("invalid NDJSON line %q: %v", sc.Text(), err)
		}
		types = append(types, m["type"].(string))
		lastLine = m
	}
	if strings.Join(types, ",") != "log,user,user,log,issues,issue,issue,done,done,all_done" {
		t.Errorf("types: %v", types)
	}
	if lastLine["authors"] != 2.0 || lastLine["seconds"] != 5400.0 {
		t.Errorf("all_done: %v", lastLine)
	}
	if strings.Contains(rec.Body.String(), "SECRET-TOKEN") {
		t.Error("token in stream")
	}
}

func TestMultiValidation(t *testing.T) {
	calls := 0
	s, _ := newServer(t, nil, WithJiraClient(fakeJira(t, func(http.ResponseWriter, *http.Request) { calls++ })))
	users := func(n int) string {
		var u []string
		for i := range n {
			u = append(u, `"u`+strings.Repeat("x", i)+`@x.io"`)
		}
		return strings.Join(u, ",")
	}
	for name, body := range map[string]string{
		"0 users":       strings.Replace(multiBody, `"Ann@x.io","bob@x.io"`, "", 1),
		"blank users":   strings.Replace(multiBody, `"Ann@x.io","bob@x.io"`, `"  ",""`, 1),
		"51 users":      strings.Replace(multiBody, `"Ann@x.io","bob@x.io"`, users(51), 1),
		"user no @":     strings.Replace(multiBody, `"bob@x.io"`, `"bob"`, 1),
		"bad api_email": strings.Replace(multiBody, "me@x.io", "me", 1),
		"bad range":     strings.Replace(multiBody, `"2026-10-01"`, `"2026-11-01"`, 1),
		"367 days":      strings.Replace(strings.Replace(multiBody, `"2026-10-01"`, `"2025-10-01"`, 1), `"2026-10-31"`, `"2026-10-02"`, 1),
		"non-atlassian": strings.Replace(multiBody, "acme.atlassian.net", "jira.example.com", 1),
	} {
		t.Run(name, func(t *testing.T) {
			rec := do(s, "POST", "/api/worklogs/multi", body)
			if rec.Code != 400 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
				t.Errorf("%d %s", rec.Code, rec.Body)
			}
		})
	}
	if rec := do(s, "POST", "/api/worklogs/multi", strings.Replace(multiBody, `"Ann@x.io","bob@x.io"`, users(50), 1)); rec.Code != 200 {
		t.Errorf("50 users: %d %s", rec.Code, rec.Body)
	}
	if calls == 0 {
		t.Error("valid request never reached Jira")
	}
}

func TestMultiAuthAndOrigin(t *testing.T) {
	s, _ := newServer(t, map[string]string{"LOGIN_PASS": "hunter2", "BASE_URL": "https://app.example.com"},
		WithJiraClient(fakeJira(t, multiJira)))
	if rec := do(s, "POST", "/api/worklogs/multi", multiBody); rec.Code != 401 {
		t.Errorf("no session: %d", rec.Code)
	}
	ck := login(t, s)
	if rec := do(s, "POST", "/api/worklogs/multi", multiBody, withCookie(ck), withHeader("Origin", "https://evil.example")); rec.Code != 403 {
		t.Errorf("cross-origin: %d", rec.Code)
	}
	if rec := do(s, "POST", "/api/worklogs/multi", multiBody, withCookie(ck)); rec.Code != 200 {
		t.Errorf("with session: %d %s", rec.Code, rec.Body)
	}
}

func TestMultiDoesNotReadStore(t *testing.T) {
	s, cfg := newServer(t, nil, WithJiraClient(fakeJira(t, multiJira)))
	do(s, "POST", "/api/worklogs/multi", multiBody)
	if _, err := os.Stat(cfg.JSONPath); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("multi must not save settings: %v", err)
	}
}

func TestMultiCancelStopsFetch(t *testing.T) {
	started := make(chan struct{})
	var calls atomic.Int32
	hc := fakeJira(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-r.Context().Done()
	})
	s, _ := newServer(t, nil, WithJiraClient(hc))
	ts := httptest.NewServer(s)
	defer ts.Close()

	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, ts.URL+"/api/worklogs/multi", strings.NewReader(multiBody))
	req.Header.Set("Content-Type", "application/json")
	done := make(chan struct{})
	go func() {
		defer close(done)
		if resp, err := ts.Client().Do(req); err == nil {
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
		}
	}()
	<-started
	cancel()
	<-done
	time.Sleep(100 * time.Millisecond)
	if n := calls.Load(); n != 1 {
		t.Errorf("jira calls: %d", n)
	}
}

func TestSettingsWorkHours(t *testing.T) {
	s, _ := newServer(t, nil)
	if rec := do(s, "GET", "/api/settings", ""); !strings.Contains(rec.Body.String(), `"work_hours":8`) {
		t.Errorf("default: %s", rec.Body)
	}
	bad := strings.Replace(validSettings, `"timezone"`, `"work_hours":13,"timezone"`, 1)
	rec := do(s, "PUT", "/api/settings", bad)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), `{"error":"Work hours per day must be 1 to 12."}`) {
		t.Errorf("13: %d %s", rec.Code, rec.Body)
	}
	ok := strings.Replace(validSettings, `"timezone"`, `"work_hours":6,"timezone"`, 1)
	if rec := do(s, "PUT", "/api/settings", ok); rec.Code != 204 {
		t.Fatalf("put 6: %d %s", rec.Code, rec.Body)
	}
	if rec := do(s, "GET", "/api/settings", ""); !strings.Contains(rec.Body.String(), `"work_hours":6`) {
		t.Errorf("saved: %s", rec.Body)
	}
	zero := strings.Replace(validSettings, `"timezone"`, `"work_hours":0,"timezone"`, 1)
	do(s, "PUT", "/api/settings", zero)
	if rec := do(s, "GET", "/api/settings", ""); !strings.Contains(rec.Body.String(), `"work_hours":8`) {
		t.Errorf("zero: %s", rec.Body)
	}
}

func TestSettingsOldFileLoadsWorkHours(t *testing.T) {
	s, cfg := newServer(t, nil)
	old := `{"jira_domain":"https://acme.atlassian.net","user":"a@b.c","api_email":"a@b.c","same_as_user":true,"api_token":"tok","timezone":"Asia/Manila"}`
	if err := os.WriteFile(cfg.JSONPath, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	if rec := do(s, "GET", "/api/settings", ""); !strings.Contains(rec.Body.String(), `"work_hours":8`) {
		t.Errorf("old file: %s", rec.Body)
	}
}

func TestWorklogsWorkHoursRange(t *testing.T) {
	calls := 0
	s, _ := newServer(t, nil, WithJiraClient(fakeJira(t, func(http.ResponseWriter, *http.Request) { calls++ })))
	bad := strings.Replace(worklogBody, `"timezone"`, `"work_hours":13,"timezone"`, 1)
	if rec := do(s, "POST", "/api/worklogs", bad); rec.Code != 400 || calls != 0 {
		t.Errorf("13: %d calls=%d %s", rec.Code, calls, rec.Body)
	}
}
