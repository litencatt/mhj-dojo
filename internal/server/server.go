// Package server exposes the JSON API (docs/api.md) and serves the embedded
// single-page frontend.
package server

import (
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"path"
	"strings"

	"github.com/litencatt/mhj2/internal/game"
	"github.com/litencatt/mhj2/internal/match"
	"github.com/litencatt/mhj2/internal/session"
)

//go:embed all:static
var staticFS embed.FS

const maxBody = 1 << 16

// New returns the HTTP handler for the API and the embedded frontend.
func New(store *session.Store, games *match.Store) http.Handler {
	static, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic(err)
	}
	return NewWithFS(store, games, static)
}

// NewWithFS is New with an explicit frontend file system (for tests).
func NewWithFS(store *session.Store, games *match.Store, static fs.FS) http.Handler {
	a := &api{store: store, games: games}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/sessions", a.create)
	mux.HandleFunc("GET /api/sessions/{id}", a.withSession(func(s *session.Session, _ *http.Request) (session.State, error) {
		return s.State(), nil
	}))
	mux.HandleFunc("POST /api/sessions/{id}/discard", a.withSession(func(s *session.Session, r *http.Request) (session.State, error) {
		var body struct {
			Tile *string `json:"tile"`
		}
		if err := decode(r, &body, true); err != nil {
			return session.State{}, err
		}
		if body.Tile == nil {
			return session.State{}, errInvalid("tile is required")
		}
		return s.Discard(*body.Tile)
	}))
	mux.HandleFunc("POST /api/sessions/{id}/tsumo", a.withSession(func(s *session.Session, _ *http.Request) (session.State, error) {
		return s.Tsumo()
	}))
	mux.HandleFunc("POST /api/sessions/{id}/goto", a.withSession(func(s *session.Session, r *http.Request) (session.State, error) {
		var body struct {
			NodeID *int `json:"node_id"`
		}
		if err := decode(r, &body, true); err != nil {
			return session.State{}, err
		}
		if body.NodeID == nil {
			return session.State{}, errInvalid("node_id is required")
		}
		return s.Goto(*body.NodeID)
	}))
	mux.HandleFunc("POST /api/games", a.createGame)
	mux.HandleFunc("GET /api/games/{id}", a.withGame(func(m *match.Match, _ *http.Request) (match.State, error) {
		return m.State(), nil
	}))
	mux.HandleFunc("POST /api/games/{id}/action", a.withGame(func(m *match.Match, r *http.Request) (match.State, error) {
		var body struct {
			Type game.ActionType `json:"type"`
			Tile string          `json:"tile"`
		}
		if err := decode(r, &body, true); err != nil {
			return match.State{}, err
		}
		switch body.Type {
		case game.Discard, game.Riichi:
			if body.Tile == "" {
				return match.State{}, errInvalid("tile is required for " + string(body.Type))
			}
		case game.Tsumo, game.Ron, game.Skip:
		default:
			return match.State{}, errInvalid("type must be discard, riichi, tsumo, ron or skip")
		}
		return m.Act(game.Action{Type: body.Type, Tile: body.Tile})
	}))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "no such endpoint: "+r.Method+" "+r.URL.Path)
	})
	mux.Handle("/", spa(static))
	return guard(mux)
}

// guard rejects requests whose Host is not a loopback name (DNS rebinding)
// and POSTs without a JSON content type (cross-site form posts).
func guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !loopbackHost(r.Host) {
			writeError(w, http.StatusForbidden, "host not allowed: "+r.Host)
			return
		}
		if r.Method == http.MethodPost {
			mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil || mt != "application/json" {
				writeError(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func loopbackHost(hostport string) bool {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

type api struct {
	store *session.Store
	games *match.Store
}

func (a *api) createGame(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Seed *int64 `json:"seed"`
	}
	if err := decode(r, &body, false); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a.games.Create(body.Seed).State())
}

func (a *api) withGame(f func(*match.Match, *http.Request) (match.State, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		m, err := a.games.Get(r.PathValue("id"))
		if err != nil {
			writeErr(w, err)
			return
		}
		st, err := f(m, r)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, st)
	}
}

func (a *api) create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Seed     *int64 `json:"seed"`
		MaxTurns int    `json:"max_turns"`
	}
	if err := decode(r, &body, false); err != nil {
		writeErr(w, err)
		return
	}
	s, err := a.store.Create(body.Seed, body.MaxTurns)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.State())
}

func (a *api) withSession(f func(*session.Session, *http.Request) (session.State, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s, err := a.store.Get(r.PathValue("id"))
		if err != nil {
			writeErr(w, err)
			return
		}
		st, err := f(s, r)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, st)
	}
}

func errInvalid(msg string) error { return errors.Join(session.ErrInvalid, errors.New(msg)) }

// decode reads a JSON body; an empty body is allowed unless required.
func decode(r *http.Request, v any, required bool) error {
	err := json.NewDecoder(io.LimitReader(r.Body, maxBody)).Decode(v)
	switch {
	case errors.Is(err, io.EOF) && !required:
		return nil
	case errors.Is(err, io.EOF):
		return errInvalid("request body is required")
	case err != nil:
		return errInvalid("invalid JSON body: " + err.Error())
	}
	return nil
}

func writeErr(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, session.ErrNotFound), errors.Is(err, match.ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, session.ErrInvalid), errors.Is(err, game.ErrInvalid):
		status = http.StatusBadRequest
	case errors.Is(err, session.ErrConflict), errors.Is(err, game.ErrConflict):
		status = http.StatusConflict
	}
	msg := err.Error()
	// errors.Join renders one line per error; keep the specific message.
	if i := strings.LastIndexByte(msg, '\n'); i >= 0 {
		msg = msg[i+1:]
	}
	writeError(w, status, msg)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// spa serves static files and falls back to index.html for unknown paths.
func spa(static fs.FS) http.Handler {
	files := http.FileServerFS(static)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}
		if st, err := fs.Stat(static, name); err == nil && !st.IsDir() {
			files.ServeHTTP(w, r)
			return
		}
		index, err := fs.ReadFile(static, "index.html")
		if err != nil {
			http.Error(w, "frontend not built", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	})
}
