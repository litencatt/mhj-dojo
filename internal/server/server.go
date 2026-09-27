// Package server exposes the JSON API (docs/api.md) and serves the embedded
// single-page frontend.
package server

import (
	"embed"
	"encoding/json"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"path"
	"strings"

	"github.com/litencatt/mhj-dojo/internal/apicall"
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/match"
	"github.com/litencatt/mhj-dojo/internal/session"
)

//go:embed all:static
var staticFS embed.FS

func init() {
	// Go's mime package doesn't know this extension (it has no OS mime.types
	// entry), so http.FileServerFS would otherwise serve the manifest as
	// text/plain.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

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
		return apicall.Discard(s, r.Body)
	}))
	mux.HandleFunc("POST /api/sessions/{id}/tsumo", a.withSession(func(s *session.Session, r *http.Request) (session.State, error) {
		return apicall.Tsumo(s, r.Body)
	}))
	mux.HandleFunc("POST /api/sessions/{id}/goto", a.withSession(func(s *session.Session, r *http.Request) (session.State, error) {
		return apicall.Goto(s, r.Body)
	}))
	mux.HandleFunc("GET /api/version", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, apicall.Version())
	})
	mux.HandleFunc("POST /api/games", a.createGame)
	mux.HandleFunc("GET /api/games/{id}", a.withGame(func(m *match.Match, _ *http.Request) (match.State, error) {
		return m.State(), nil
	}))
	mux.HandleFunc("POST /api/games/{id}/action", a.withGame(func(m *match.Match, r *http.Request) (match.State, error) {
		var body struct {
			Type  game.ActionType `json:"type"`
			Tile  string          `json:"tile"`
			Tiles []string        `json:"tiles"`
		}
		if err := apicall.Decode(r.Body, &body, true); err != nil {
			return match.State{}, err
		}
		switch body.Type {
		case game.Discard, game.Riichi:
			if body.Tile == "" {
				return match.State{}, apicall.Invalid("tile is required for " + string(body.Type))
			}
		case game.Chii:
			if len(body.Tiles) != 2 {
				return match.State{}, apicall.Invalid("tiles (two) are required for chii")
			}
		case game.Tsumo, game.Ron, game.Skip, game.Kyuushu, game.Pon, game.Kan:
		case actionNext:
			return m.Next()
		default:
			return match.State{}, apicall.Invalid("type must be discard, riichi, tsumo, ron, skip, pon, chii, kan, kyuushu or next")
		}
		return m.Act(game.Action{Type: body.Type, Tile: body.Tile, Tiles: body.Tiles})
	}))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "no such endpoint: "+r.Method+" "+r.URL.Path)
	})
	mux.Handle("/", spa(static))
	return guard(mux)
}

// guard rejects requests whose Host is not a loopback name (DNS rebinding)
// and POSTs without a JSON content type (cross-site form posts), and sets
// the response headers that keep other origins from embedding the app. It
// is a browser-side defence only: a network client can send any Host.
func guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		// Other origins may not frame the app (clickjacking a discard).
		h.Set("Content-Security-Policy", "frame-ancestors 'none'")
		h.Set("X-Frame-Options", "DENY")
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

// actionNext deals the next round of a game; it is not a round move.
const actionNext game.ActionType = "next"

func (a *api) createGame(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Seed        *int64 `json:"seed"`
		Length      string `json:"length"`
		FirstDealer string `json:"first_dealer"`
		CPU         string `json:"cpu"`
	}
	if err := apicall.Decode(r.Body, &body, false); err != nil {
		writeErr(w, err)
		return
	}
	m, err := a.games.Create(body.Seed, match.Options{Length: body.Length, FirstDealer: body.FirstDealer, CPU: body.CPU})
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m.State())
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
	st, err := apicall.CreateSession(a.store, r.Body)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
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

func writeErr(w http.ResponseWriter, err error) {
	writeError(w, apicall.Status(err), apicall.Message(err))
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, apicall.ErrorBody(msg))
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
