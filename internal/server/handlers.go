package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"

	"gitlab.com/acerodnel/jira-workloginator/internal/jira"
	"gitlab.com/acerodnel/jira-workloginator/internal/settings"
)

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{
		"login_required": s.auth != nil,
		"authenticated":  s.auth == nil || s.auth.valid(r),
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if s.auth == nil {
		writeError(w, http.StatusNotFound, "Login is not enabled.")
		return
	}
	peer := clientHost(r)
	if !s.limiter.take(peer) {
		w.Header().Set("Retry-After", "900")
		writeError(w, http.StatusTooManyRequests, "Too many attempts. Try again later.")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if !s.auth.checkPassword(body.Password) {
		slog.Info("login failed")
		writeError(w, http.StatusUnauthorized, "Wrong password.")
		return
	}
	s.limiter.release(peer)
	s.auth.setCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleLogout(w http.ResponseWriter, _ *http.Request) {
	if s.auth != nil {
		s.auth.clearCookie(w)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	st, _, err := s.store.Load(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	if st.Users == nil { // a stored "users": null must still reach the UI as []
		st.Users = []string{}
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var in settings.Settings
	if !readJSON(w, r, &in) {
		return
	}
	st, _, err := in.Validate()
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.Save(r.Context(), st); err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// worklogsRequest is the settings fields plus the date range; it never reads the store.
type worklogsRequest struct {
	settings.Settings
	From string `json:"from"`
	To   string `json:"to"`
}

// handleWorklogs streams the single-user fetch as NDJSON. Validation failures
// answer 400 before streaming starts.
func (s *Server) handleWorklogs(w http.ResponseWriter, r *http.Request) {
	var in worklogsRequest
	if !readJSON(w, r, &in) {
		return
	}
	st, loc, err := in.Validate()
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if st.User == "" { // Validate only requires it with same_as_user
		writeError(w, http.StatusBadRequest, "User must be an email address.")
		return
	}
	from, to, err := settings.ParseRange(in.From, in.To)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	slog.Debug("fetch user", "user", st.User)
	s.stream(w, r, st, jira.Request{Users: []string{st.User}, From: from, To: to, Loc: loc}, in.From, in.To)
}

// multiRequest is the body of POST /api/worklogs/multi; it never reads the store.
type multiRequest struct {
	JiraDomain string   `json:"jira_domain"`
	APIEmail   string   `json:"api_email"`
	APIToken   string   `json:"api_token"`
	Timezone   string   `json:"timezone"`
	Users      []string `json:"users"`
	From       string   `json:"from"`
	To         string   `json:"to"`
}

// handleWorklogsMulti streams the fetch for many users (one Jira search) as NDJSON.
func (s *Server) handleWorklogsMulti(w http.ResponseWriter, r *http.Request) {
	var in multiRequest
	if !readJSON(w, r, &in) {
		return
	}
	st, loc, err := settings.Settings{
		JiraDomain: in.JiraDomain, APIEmail: in.APIEmail, APIToken: in.APIToken, Timezone: in.Timezone, Users: in.Users,
	}.Validate()
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(st.Users) == 0 {
		writeError(w, http.StatusBadRequest, "At least one user is required.")
		return
	}
	from, to, err := settings.ParseRange(in.From, in.To)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.stream(w, r, st, jira.Request{Users: st.Users, Multi: true, From: from, To: to, Loc: loc}, in.From, in.To)
}

// stream writes the NDJSON answer for req, flushing every line.
func (s *Server) stream(w http.ResponseWriter, r *http.Request, st settings.Settings, req jira.Request, fromStr, toStr string) {
	h := w.Header()
	h.Set("Content-Type", "application/x-ndjson")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	rc := http.NewResponseController(w)
	enc := json.NewEncoder(w)
	emit := func(ev any) {
		if enc.Encode(ev) == nil { // Encode appends the newline
			_ = rc.Flush()
		}
	}
	_ = rc.Flush()

	host := ""
	if u, err := url.Parse(st.JiraDomain); err == nil {
		host = u.Host
	}
	slog.Info("fetch started", "host", host, "from", fromStr, "to", toStr, "users", len(req.Users))

	client := jira.NewClient(s.jira, st.JiraDomain, st.APIEmail, st.APIToken)
	var issues, logs int
	client.Fetch(r.Context(), req, func(ev any) {
		switch e := ev.(type) {
		case jira.Done:
			issues += e.Issues
			logs += e.Worklogs
		case jira.Error:
			slog.Warn("fetch error", "host", host, "fatal", e.Fatal)
		}
		emit(ev)
	})
	if r.Context().Err() != nil {
		slog.Info("fetch cancelled", "host", host)
		return
	}
	slog.Info("fetch finished", "host", host, "issues", issues, "worklogs", logs)
}
