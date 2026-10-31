package main

import (
	"context"
	"io"
	"net"
	"net/http"
	"testing"
	"time"
)

// SIGTERM (ctx cancel) must cancel an in-flight streaming request and let serve
// return nil well before the 10s shutdown timeout.
func TestServeCancelsInFlightRequests(t *testing.T) {
	started := make(chan struct{})
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	})}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- serve(ctx, srv, ln) }()

	resp, err := http.Get("http://" + ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	<-started
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("serve returned %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("serve did not stop after cancel")
	}
	_, _ = io.Copy(io.Discard, resp.Body)
}
