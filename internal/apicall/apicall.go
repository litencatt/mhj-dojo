// Package apicall is the engine's entry for the page's requests
// (docs/api.md): decoding request bodies, running the practice and game
// operations and mapping errors to HTTP status codes. The WebAssembly build
// (cmd/mhj-dojo-wasm) answers every request through Route.
package apicall

import (
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"

	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/match"
	"github.com/litencatt/mhj-dojo/internal/session"
)

// maxBody bounds a request body.
const maxBody = 1 << 16

// HTTP statuses and methods, spelled out so that the WebAssembly build does
// not link net/http.
const (
	statusOK                  = 200
	statusBadRequest          = 400
	statusNotFound            = 404
	statusConflict            = 409
	statusUnprocessableEntity = 422
	statusInternalServerError = 500
	methodGet                 = "GET"
	methodPost                = "POST"
)

// Invalid returns a session.ErrInvalid (400) error with msg as its message.
func Invalid(msg string) error { return errors.Join(session.ErrInvalid, errors.New(msg)) }

// Decode reads a JSON body into v; an empty body is allowed unless required.
func Decode(r io.Reader, v any, required bool) error {
	err := json.NewDecoder(io.LimitReader(r, maxBody)).Decode(v)
	switch {
	case errors.Is(err, io.EOF) && !required:
		return nil
	case errors.Is(err, io.EOF):
		return Invalid("request body is required")
	case err != nil:
		return Invalid("invalid JSON body: " + err.Error())
	}
	return nil
}

// Status returns the HTTP status for an error from a session, a game or
// Decode.
func Status(err error) int {
	switch {
	case errors.Is(err, session.ErrNotFound), errors.Is(err, match.ErrNotFound):
		return statusNotFound
	case errors.Is(err, session.ErrInvalid), errors.Is(err, game.ErrInvalid):
		return statusBadRequest
	case errors.Is(err, session.ErrTreeFull):
		// Not a state conflict: the current node is fine to act on.
		return statusUnprocessableEntity
	case errors.Is(err, session.ErrConflict), errors.Is(err, game.ErrConflict):
		return statusConflict
	}
	return statusInternalServerError
}

// Message returns the error's message for the {"error": ...} body.
func Message(err error) string {
	msg := err.Error()
	// errors.Join renders one line per error; keep the specific message.
	if i := strings.LastIndexByte(msg, '\n'); i >= 0 {
		msg = msg[i+1:]
	}
	return msg
}

// ErrorBody is the JSON body of an error response.
func ErrorBody(msg string) map[string]string { return map[string]string{"error": msg} }

// SessionView reads the view options of a practice request from its URL
// query (docs/api.md "View options"): advice=0 leaves the advice out, and
// tree_from=<n> leaves out the tree's first n nodes (those with an id below
// n). Other keys are ignored; of a key given twice, the last one counts.
func SessionView(query string) (session.View, error) {
	var v session.View
	for _, kv := range strings.Split(query, "&") {
		k, val, _ := strings.Cut(kv, "=")
		switch k {
		case "advice":
			if val != "0" && val != "1" {
				return v, Invalid("advice must be 0 or 1")
			}
			v.NoAdvice = val == "0"
		case "tree_from":
			n, err := strconv.Atoi(val)
			if err != nil || n < 0 {
				return v, Invalid("tree_from must be a non-negative integer")
			}
			v.TreeFrom = n
		}
	}
	return v, nil
}

// CreateSession is Route's POST /api/sessions.
func CreateSession(store *session.Store, v session.View, body io.Reader) (session.State, error) {
	var req struct {
		Seed     *int64 `json:"seed"`
		MaxTurns int    `json:"max_turns"`
	}
	if err := Decode(body, &req, false); err != nil {
		return session.State{}, err
	}
	s, err := store.Create(req.Seed, req.MaxTurns)
	if err != nil {
		return session.State{}, err
	}
	return s.State(v), nil
}

// Discard is Route's POST /api/sessions/{id}/discard.
func Discard(s *session.Session, v session.View, body io.Reader) (session.State, error) {
	var req struct {
		Tile   *string `json:"tile"`
		NodeID *int    `json:"node_id"`
	}
	if err := Decode(body, &req, true); err != nil {
		return session.State{}, err
	}
	if req.Tile == nil {
		return session.State{}, Invalid("tile is required")
	}
	return s.Discard(*req.Tile, req.NodeID, v)
}

// Tsumo is Route's POST /api/sessions/{id}/tsumo.
func Tsumo(s *session.Session, v session.View, body io.Reader) (session.State, error) {
	var req struct {
		NodeID *int `json:"node_id"`
	}
	if err := Decode(body, &req, false); err != nil {
		return session.State{}, err
	}
	return s.Tsumo(req.NodeID, v)
}

// Goto is Route's POST /api/sessions/{id}/goto.
func Goto(s *session.Session, v session.View, body io.Reader) (session.State, error) {
	var req struct {
		NodeID *int `json:"node_id"`
	}
	if err := Decode(body, &req, true); err != nil {
		return session.State{}, err
	}
	if req.NodeID == nil {
		return session.State{}, Invalid("node_id is required")
	}
	return s.Goto(*req.NodeID, v)
}

// CreateGame is Route's POST /api/games.
func CreateGame(games *match.Store, body io.Reader) (match.State, error) {
	var req struct {
		Seed        *int64 `json:"seed"`
		Length      string `json:"length"`
		FirstDealer string `json:"first_dealer"`
		CPU         string `json:"cpu"`
	}
	if err := Decode(body, &req, false); err != nil {
		return match.State{}, err
	}
	m, err := games.Create(req.Seed, match.Options{Length: req.Length, FirstDealer: req.FirstDealer, CPU: req.CPU})
	if err != nil {
		return match.State{}, err
	}
	return m.State(), nil
}

// GameAction is Route's POST /api/games/{id}/action: one of the human's
// moves, or "next".
func GameAction(m *match.Match, body io.Reader) (match.State, error) {
	var req struct {
		Type  game.ActionType `json:"type"`
		Tile  string          `json:"tile"`
		Tiles []string        `json:"tiles"`
	}
	if err := Decode(body, &req, true); err != nil {
		return match.State{}, err
	}
	switch req.Type {
	case game.Discard, game.Riichi:
		if req.Tile == "" {
			return match.State{}, Invalid("tile is required for " + string(req.Type))
		}
	case game.Chii:
		if len(req.Tiles) != 2 {
			return match.State{}, Invalid("tiles (two) are required for chii")
		}
	case game.Tsumo, game.Ron, game.Skip, game.Kyuushu, game.Pon, game.Kan:
	case match.ActionNext:
		return m.Next()
	default:
		return match.State{}, Invalid("type must be discard, riichi, tsumo, ron, skip, pon, chii, kan, kyuushu or next")
	}
	return m.Act(game.Action{Type: req.Type, Tile: req.Tile, Tiles: req.Tiles})
}

// Route runs one request given as its method and path, with any query (such
// as "POST", "/api/sessions/{id}/discard?advice=0"): the engine's entry for
// every operation, which the WebAssembly build calls. It returns the status
// (an HTTP status code) and the response value: a session.State, a
// match.State or an ErrorBody. Any other path is a 404.
func Route(store *session.Store, games *match.Store, method, path string, body io.Reader) (int, any) {
	path, query, _ := strings.Cut(path, "?")
	return result(route(store, games, method, path, query, body))
}

// Restore rebuilds a session from its moves in one call (session.Replay)
// and returns the status and response value of its final state. It is not a
// request (Route does not answer it): the WebAssembly build uses it to bring
// a session back after a page reload. The body is {"seed", "max_turns", "moves",
// "current"}, moves as [{"parent": 0, "tile": "5m"}, {"parent": 3}] (no
// tile: tsumo); query holds view options as for a request (SessionView).
func Restore(store *session.Store, query string, body io.Reader) (int, any) {
	var req struct {
		Seed     *int64         `json:"seed"`
		MaxTurns int            `json:"max_turns"`
		Moves    []session.Move `json:"moves"`
		Current  int            `json:"current"`
	}
	if err := Decode(body, &req, true); err != nil {
		return result(session.State{}, err)
	}
	if req.Seed == nil {
		return result(session.State{}, Invalid("seed is required"))
	}
	v, err := SessionView(query)
	if err != nil {
		return result(session.State{}, err)
	}
	s, err := store.Create(req.Seed, req.MaxTurns)
	if err != nil {
		return result(session.State{}, err)
	}
	st, err := s.Replay(req.Moves, req.Current, v)
	if err != nil {
		store.Delete(s.ID()) // half built: nobody will ever ask for it
	}
	return result(st, err)
}

// RestoreGame rebuilds a game under a new id from its match.Save (the JSON
// body) and returns the status and response value of its state. Like
// Restore it is not a request (Route does not answer it): the WebAssembly
// build uses it to bring a game back after a page reload.
func RestoreGame(games *match.Store, body io.Reader) (int, any) {
	var req match.Save
	if err := Decode(body, &req, true); err != nil {
		return result(match.State{}, err)
	}
	m, err := games.Restore(req)
	if err != nil {
		return result(match.State{}, err)
	}
	return result(m.State(), nil)
}

func result(v any, err error) (int, any) {
	if err != nil {
		return Status(err), ErrorBody(Message(err))
	}
	return statusOK, v
}

func route(store *session.Store, games *match.Store, method, path, query string, body io.Reader) (any, error) {
	// The message for a path no request matches.
	noEndpoint := errors.Join(session.ErrNotFound, errors.New("no such endpoint: "+method+" "+path))
	if rest, ok := strings.CutPrefix(path, "/api/sessions"); ok {
		var f func(*session.Session, session.View, io.Reader) (session.State, error)
		id, op, ok := resource(rest)
		switch {
		case rest == "" && method == methodPost:
		case !ok:
			return nil, noEndpoint
		case method == methodGet && op == "":
			f = func(s *session.Session, v session.View, _ io.Reader) (session.State, error) { return s.State(v), nil }
		case method == methodPost && op == "discard":
			f = Discard
		case method == methodPost && op == "tsumo":
			f = Tsumo
		case method == methodPost && op == "goto":
			f = Goto
		default:
			return nil, noEndpoint
		}
		var s *session.Session
		if f != nil {
			var err error
			if s, err = store.Get(id); err != nil {
				return nil, err
			}
		}
		v, err := SessionView(query)
		if err != nil {
			return nil, err
		}
		if f == nil {
			return CreateSession(store, v, body)
		}
		return f(s, v, body)
	}
	if rest, ok := strings.CutPrefix(path, "/api/games"); ok {
		if rest == "" {
			if method != methodPost {
				return nil, noEndpoint
			}
			return CreateGame(games, body)
		}
		id, op, ok := resource(rest)
		if !ok {
			return nil, noEndpoint
		}
		var f func(*match.Match, io.Reader) (match.State, error)
		switch {
		case method == methodGet && op == "":
			f = func(m *match.Match, _ io.Reader) (match.State, error) { return m.State(), nil }
		case method == methodPost && op == "action":
			f = GameAction
		default:
			return nil, noEndpoint
		}
		m, err := games.Get(id)
		if err != nil {
			return nil, err
		}
		return f(m, body)
	}
	return nil, noEndpoint
}

// resource splits the rest of a path after its collection ("/{id}" or
// "/{id}/{op}") into the id and the op ("" for none); ok is false for any
// other shape, such as an empty id or a trailing slash.
func resource(rest string) (id, op string, ok bool) {
	id, op, sub := strings.Cut(strings.TrimPrefix(rest, "/"), "/")
	if id == "" || !strings.HasPrefix(rest, "/") || (sub && op == "") || strings.Contains(op, "/") {
		return "", "", false
	}
	return id, op, true
}
