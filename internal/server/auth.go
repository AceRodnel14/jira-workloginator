package server

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"net/http"
	"time"
)

const (
	sessionCookie = "jwl_session"
	sessionTTL    = 12 * time.Hour
	kdfSalt       = "jira-workloginator/session/v1"
)

// kdfIterations is a variable only so tests can lower it.
var kdfIterations = 600_000

// auth issues and checks the stateless session cookie. Nil when LOGIN_PASS is empty.
type auth struct {
	key      []byte
	passHash [sha256.Size]byte
	secure   bool
	now      func() time.Time
}

func newAuth(cfg Config) (*auth, error) {
	if cfg.LoginPass == "" {
		return nil, nil
	}
	key, err := pbkdf2.Key(sha256.New, cfg.LoginPass, []byte(kdfSalt), kdfIterations, 32)
	if err != nil {
		return nil, err
	}
	return &auth{key: key, passHash: sha256.Sum256([]byte(cfg.LoginPass)), secure: cfg.secureCookies(), now: time.Now}, nil
}

// checkPassword compares SHA-256 digests in constant time.
func (a *auth) checkPassword(pw string) bool {
	h := sha256.Sum256([]byte(pw))
	return subtle.ConstantTimeCompare(h[:], a.passHash[:]) == 1
}

func (a *auth) sign(expiry int64) []byte {
	msg := binary.BigEndian.AppendUint64(nil, uint64(expiry))
	mac := hmac.New(sha256.New, a.key)
	mac.Write(msg)
	return mac.Sum(msg)
}

// valid reports whether the request carries an untampered, unexpired cookie.
func (a *auth) valid(r *http.Request) bool {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(c.Value)
	if err != nil || len(raw) != 8+sha256.Size {
		return false
	}
	expiry := int64(binary.BigEndian.Uint64(raw[:8]))
	if !hmac.Equal(raw, a.sign(expiry)) {
		return false
	}
	return a.now().Unix() < expiry
}

func (a *auth) setCookie(w http.ResponseWriter) {
	exp := a.now().Add(sessionTTL)
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: base64.RawURLEncoding.EncodeToString(a.sign(exp.Unix())),
		Path: "/", Expires: exp, MaxAge: int(sessionTTL.Seconds()),
		HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteLaxMode,
	})
}

func (a *auth) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteLaxMode,
	})
}
