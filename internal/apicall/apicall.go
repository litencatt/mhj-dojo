// Package apicall is the transport-independent part of the JSON API
// (docs/api.md): decoding request bodies, running the practice operations
// and mapping errors to HTTP statuses. The HTTP server (internal/server) and
// the WebAssembly build (cmd/mhj-dojo-wasm) share it, so both answer the same
// request with the same JSON.
package apicall

import (
	"encoding/json"
	"errors"
	"io"
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
		// Not a state conflict (the current node is fine); a client that
		// re-fetches on 409 to recover from another tab's progress must
		// not treat this the same way, since re-fetching changes nothing.
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

// CreateSession is POST /api/sessions.
func CreateSession(store *session.Store, body io.Reader) (session.State, error) {
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
	return s.State(), nil
}

// Discard is POST /api/sessions/{id}/discard.
func Discard(s *session.Session, body io.Reader) (session.State, error) {
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
	return s.Discard(*req.Tile, req.NodeID)
}

// Tsumo is POST /api/sessions/{id}/tsumo.
func Tsumo(s *session.Session, body io.Reader) (session.State, error) {
	var req struct {
		NodeID *int `json:"node_id"`
	}
	if err := Decode(body, &req, false); err != nil {
		return session.State{}, err
	}
	return s.Tsumo(req.NodeID)
}

// Goto is POST /api/sessions/{id}/goto.
func Goto(s *session.Session, body io.Reader) (session.State, error) {
	var req struct {
		NodeID *int `json:"node_id"`
	}
	if err := Decode(body, &req, true); err != nil {
		return session.State{}, err
	}
	if req.NodeID == nil {
		return session.State{}, Invalid("node_id is required")
	}
	return s.Goto(*req.NodeID)
}

// Route runs one practice-session request given as its HTTP method and
// API path (such as "POST", "/api/sessions/{id}/discard"), for a transport
// without an HTTP router (the WebAssembly build). It returns the status and
// the response value the HTTP server would send; any other path, game
// endpoints included, is a 404 as for an unknown endpoint.
func Route(store *session.Store, method, path string, body io.Reader) (int, any) {
	return result(route(store, method, path, body))
}

// Restore rebuilds a session from its moves in one call (session.Replay)
// and returns the status and response value of its final state. It is not
// an HTTP endpoint: the WebAssembly build uses it to bring a session back
// after a page reload. The body is {"seed", "max_turns", "moves",
// "current"}, moves as [{"parent": 0, "tile": "5m"}, {"parent": 3}] (no
// tile: tsumo).
func Restore(store *session.Store, body io.Reader) (int, any) {
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
	s, err := store.Create(req.Seed, req.MaxTurns)
	if err != nil {
		return result(session.State{}, err)
	}
	st, err := s.Replay(req.Moves, req.Current)
	if err != nil {
		store.Delete(s.ID()) // half built: nobody will ever ask for it
	}
	return result(st, err)
}

func result(st session.State, err error) (int, any) {
	if err != nil {
		return Status(err), ErrorBody(Message(err))
	}
	return statusOK, st
}

func route(store *session.Store, method, path string, body io.Reader) (session.State, error) {
	// The server's message for a path no endpoint matches.
	noEndpoint := errors.Join(session.ErrNotFound, errors.New("no such endpoint: "+method+" "+path))
	rest, ok := strings.CutPrefix(path, "/api/sessions")
	if !ok {
		return session.State{}, noEndpoint
	}
	if rest == "" {
		if method != methodPost {
			return session.State{}, noEndpoint
		}
		return CreateSession(store, body)
	}
	id, op, sub := strings.Cut(strings.TrimPrefix(rest, "/"), "/")
	if id == "" || !strings.HasPrefix(rest, "/") || (sub && op == "") || strings.Contains(op, "/") {
		return session.State{}, noEndpoint
	}
	var f func(*session.Session, io.Reader) (session.State, error)
	switch {
	case method == methodGet && op == "":
		f = func(s *session.Session, _ io.Reader) (session.State, error) { return s.State(), nil }
	case method == methodPost && op == "discard":
		f = Discard
	case method == methodPost && op == "tsumo":
		f = Tsumo
	case method == methodPost && op == "goto":
		f = Goto
	default:
		return session.State{}, noEndpoint
	}
	s, err := store.Get(id)
	if err != nil {
		return session.State{}, err
	}
	return f(s, body)
}
