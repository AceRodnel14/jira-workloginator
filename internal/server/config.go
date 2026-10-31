package server

import (
	"cmp"
	"errors"
	"fmt"
	"log/slog"
)

// DataFile is where the json storage keeps the settings (the image's /data volume).
const DataFile = "/data/config.json"

// Config comes only from environment variables (documented in .env.example).
type Config struct {
	Port        string
	BaseURL     string
	LogLevel    slog.Level
	LoginPass   string // empty = no login
	Storage     string // "json" or "postgres"
	DatabaseURL string // postgres only
	JSONPath    string // json storage file; fixed, tests inject it
}

// LoadConfig reads the config through getenv (os.Getenv, or a map in tests).
func LoadConfig(getenv func(string) string) (Config, error) {
	cfg := Config{
		Port:        cmp.Or(getenv("PORT"), "8080"),
		BaseURL:     getenv("BASE_URL"),
		LoginPass:   getenv("LOGIN_PASS"),
		Storage:     cmp.Or(getenv("STORAGE"), "json"),
		DatabaseURL: getenv("DATABASE_URL"),
		JSONPath:    DataFile,
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "http://localhost:" + cfg.Port
	}
	if err := cfg.LogLevel.UnmarshalText([]byte(cmp.Or(getenv("LOG_LEVEL"), "info"))); err != nil {
		return Config{}, fmt.Errorf("LOG_LEVEL: %w", err)
	}
	if cfg.Storage != "json" && cfg.Storage != "postgres" {
		return Config{}, errors.New(`STORAGE must be "json" or "postgres"`)
	}
	return cfg, nil
}

// secureCookies reports whether BASE_URL is https, so the session cookie gets Secure.
func (c Config) secureCookies() bool {
	return len(c.BaseURL) >= 8 && c.BaseURL[:8] == "https://"
}
