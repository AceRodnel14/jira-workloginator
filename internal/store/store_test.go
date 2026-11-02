package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"gitlab.com/acerodnel/jira-workloginator/internal/settings"
)

func sample() settings.Settings {
	return settings.Settings{JiraDomain: "https://acme.atlassian.net", User: "a@b.c", SameAsUser: true, APIEmail: "a@b.c", APIToken: "tok", Timezone: "Asia/Manila", Users: []string{"x@y.z", "q@y.z"}}
}

func roundTrip(t *testing.T, st Store) {
	t.Helper()
	ctx := context.Background()
	got, ok, err := st.Load(ctx)
	if err != nil || ok || !reflect.DeepEqual(got, settings.Default()) {
		t.Fatalf("empty load: %+v %v %v", got, ok, err)
	}
	want := sample()
	if err := st.Save(ctx, want); err != nil {
		t.Fatal(err)
	}
	want.Timezone = "Etc/UTC"
	if err := st.Save(ctx, want); err != nil {
		t.Fatal(err)
	}
	got, ok, err = st.Load(ctx)
	if err != nil || !ok || !reflect.DeepEqual(got, want) {
		t.Fatalf("load: %+v %v %v", got, ok, err)
	}
}

func TestJSONRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "config.json")
	st := NewJSON(path)
	roundTrip(t, st)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("mode %v", info.Mode().Perm())
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Errorf("leftover temp files: %v", entries)
	}
	if err := st.Ping(context.Background()); err != nil {
		t.Error(err)
	}
}

func TestJSONCorrupt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte("{nope"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := NewJSON(path).Load(context.Background()); err == nil {
		t.Error("want error")
	}
}

func TestPostgresUnavailable(t *testing.T) {
	p := NewPostgres("")
	ctx := context.Background()
	if err := p.Ping(ctx); !errors.Is(err, ErrUnavailable) {
		t.Errorf("ping: %v", err)
	}
	if _, _, err := p.Load(ctx); !errors.Is(err, ErrUnavailable) {
		t.Errorf("load: %v", err)
	}
	if err := p.Save(ctx, sample()); !errors.Is(err, ErrUnavailable) {
		t.Errorf("save: %v", err)
	}
	p.Connect(ctx) // empty URL: returns at once, stays unavailable
	p.Close()
}

func TestPostgresRoundTrip(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	p := NewPostgres(url)
	defer p.Close()
	p.Connect(ctx)
	if err := p.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	pool, _ := p.conn()
	if _, err := pool.Exec(ctx, `DELETE FROM settings`); err != nil {
		t.Fatal(err)
	}
	roundTrip(t, p)
}
