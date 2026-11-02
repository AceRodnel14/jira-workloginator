// Package jira is a minimal Jira Cloud REST client and the worklog fetch pipeline.
package jira

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	maxRetries   = 3
	maxRetryWait = 30 * time.Second
	maxBodyBytes = 8 << 20
	maxErrText   = 300
)

// NewHTTPClient returns the one client used for Jira: 30s timeout, redirects are
// never followed (a 3xx is an error, so credentials are not sent elsewhere).
func NewHTTPClient() *http.Client {
	return &http.Client{
		Timeout:       30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// HTTPError is a non-2xx Jira answer. Msg is Jira's errorMessages, truncated; never a raw body.
type HTTPError struct {
	Status int
	Msg    string
}

func (e *HTTPError) Error() string {
	text := fmt.Sprintf("Jira answered %d %s", e.Status, http.StatusText(e.Status))
	if e.Msg != "" {
		text += ": " + e.Msg
	}
	return text
}

// Auth reports whether the credentials or permissions were refused.
func (e *HTTPError) Auth() bool {
	return e.Status == http.StatusUnauthorized || e.Status == http.StatusForbidden
}

// Client talks to one Jira site with Basic auth. The token never appears in errors or logs.
type Client struct {
	http  *http.Client
	base  string
	email string
	token string
	sleep func(context.Context, time.Duration) error
	// onRetry, when set, is told before each wait: status, wait, retry number, max retries.
	onRetry func(status int, wait time.Duration, retry, of int)
}

// NewClient builds a client for base (https://<sub>.atlassian.net).
func NewClient(hc *http.Client, base, email, token string) *Client {
	return &Client{http: hc, base: strings.TrimRight(base, "/"), email: email, token: token, sleep: sleep}
}

func sleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// get performs GET path?query and decodes the JSON answer into out. 429/503 are
// retried up to maxRetries times, honouring Retry-After.
func (c *Client) get(ctx context.Context, path string, q url.Values, out any) error {
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path+"?"+q.Encode(), nil)
		if err != nil {
			return err
		}
		req.SetBasicAuth(c.email, c.token)
		req.Header.Set("Accept", "application/json")
		resp, err := c.http.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			// Do's error holds the URL only (no headers), but keep the text generic.
			return errors.New("could not reach Jira (network error or timeout)")
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
		_ = resp.Body.Close()
		switch {
		case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusServiceUnavailable:
			if attempt >= maxRetries {
				return httpError(resp.StatusCode, body)
			}
			wait := retryWait(resp.Header.Get("Retry-After"), attempt)
			slog.Warn("jira asked to retry", "host", c.host(), "status", resp.StatusCode, "wait", wait, "retry", attempt+1)
			if c.onRetry != nil {
				c.onRetry(resp.StatusCode, wait, attempt+1, maxRetries)
			}
			if err := c.sleep(ctx, wait); err != nil {
				return err
			}
			continue
		case resp.StatusCode < 200 || resp.StatusCode > 299:
			return httpError(resp.StatusCode, body)
		case readErr != nil:
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return errors.New("could not read Jira's answer")
		}
		if err := json.Unmarshal(body, out); err != nil {
			return errors.New("jira sent an answer this app cannot read")
		}
		return nil
	}
}

func (c *Client) host() string {
	if u, err := url.Parse(c.base); err == nil {
		return u.Host
	}
	return ""
}

func retryWait(header string, attempt int) time.Duration {
	if secs, err := strconv.Atoi(strings.TrimSpace(header)); err == nil && secs >= 0 {
		return min(time.Duration(secs)*time.Second, maxRetryWait)
	}
	return time.Duration(attempt+1) * time.Second
}

func httpError(status int, body []byte) *HTTPError {
	var e struct {
		ErrorMessages []string `json:"errorMessages"`
	}
	_ = json.Unmarshal(body, &e)
	msg := strings.Join(e.ErrorMessages, "; ")
	if r := []rune(msg); len(r) > maxErrText {
		msg = string(r[:maxErrText]) + "..."
	}
	return &HTTPError{Status: status, Msg: msg}
}
