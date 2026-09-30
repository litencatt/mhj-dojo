//go:build js && wasm

// Command mhj-dojo-wasm is the engine, the practice mode and the CPU games,
// compiled to WebAssembly: the browser (a Web Worker,
// web/site-public/worker.js) runs the sessions and games itself, on the
// public site as in mhj-dojo.
//
// It defines three global functions:
//
//	mhjDojoRequest(method, path, body) -> {status, body, save}
//
// answers a request (docs/api.md), practice or game, given as its method,
// path and JSON body, with its status and JSON body (apicall.Route). A game
// response with a state also carries save, the game's match.Save as a JSON
// string ("" otherwise);
//
//	mhjDojoRestore(body, query) -> {status, body, save}
//
// rebuilds a session from its moves in one call after a page reload
// (apicall.Restore; not a request), answering with its state as the
// view options in query (a request's URL query, such as "advice=0"; may be
// left out) pick it; and
//
//	mhjDojoRestoreGame(save) -> {status, body, save}
//
// rebuilds a game from a save (apicall.RestoreGame; not a request).
// Both rebuild under a new id: the page maps its own ids to the engine's.
package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"

	"github.com/litencatt/mhj-dojo/internal/apicall"
	"github.com/litencatt/mhj-dojo/internal/match"
	"github.com/litencatt/mhj-dojo/internal/session"
)

// maxSessions bounds the engine's in-memory sessions much tighter than
// session.MaxSessions (256, NewStore's default): this runs in a browser tab's
// memory, and each practice session (its branch tree plus its own
// yakushanten.Analyzer memo) can hold up to ~9.8 MiB (briefly a few MiB
// more as a memo turns over), never released by Go's wasm runtime back to
// the OS (docs/api.md "Memory"). 4 is enough for the
// one game actually being played plus room to return to a couple of others
// by URL without forcing a rebuild; web/e2e/practice-saves.spec.ts asserts
// eviction past this cap and its rebuild-from-save, so keep the two in sync.
const maxSessions = 4

// maxGames bounds the engine's in-memory games the same way, much tighter
// than match.MaxGames (256, NewStore's default): a game holds its analyzer
// memo and the CPU players' shanten memo, ~8 MiB after a 半荘戦 and ~10.3
// MiB at most, briefly a few MiB more as a memo turns over (docs/api.md
// "Memory"). 2 keeps the game being played plus one more; an evicted game is
// rebuilt from its save (mhjDojoRestoreGame).
const maxGames = 2

func main() {
	store := session.NewStoreWithMax(maxSessions)
	games := match.NewStoreWithMax(maxGames)
	js.Global().Set("mhjDojoRequest", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 3 {
			return response(games, 400, apicall.ErrorBody("mhjDojoRequest takes method, path and body"))
		}
		return safely(games, func() (int, any) {
			return apicall.Route(store, games, args[0].String(), args[1].String(), strings.NewReader(args[2].String()))
		})
	}))
	js.Global().Set("mhjDojoRestore", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 && len(args) != 2 {
			return response(games, 400, apicall.ErrorBody("mhjDojoRestore takes a body and a query"))
		}
		query := ""
		if len(args) == 2 {
			query = args[1].String()
		}
		return safely(games, func() (int, any) {
			return apicall.Restore(store, query, strings.NewReader(args[0].String()))
		})
	}))
	js.Global().Set("mhjDojoRestoreGame", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 {
			return response(games, 400, apicall.ErrorBody("mhjDojoRestoreGame takes a save"))
		}
		return safely(games, func() (int, any) {
			return apicall.RestoreGame(games, strings.NewReader(args[0].String()))
		})
	}))
	select {} // keep the function callable
}

// safely runs f, turning a panic into a 500: a panic would end the Go
// program and every later call with it.
func safely(games *match.Store, f func() (int, any)) (res any) {
	defer func() {
		if r := recover(); r != nil {
			res = response(games, 500, apicall.ErrorBody(fmt.Sprint("internal error: ", r)))
		}
	}()
	status, v := f()
	return response(games, status, v)
}

// response is the {status, body, save} object handed back to JavaScript.
// save is set for a game's state only: the game it names was just answered
// from, so it is in games. The games.Get also marks that game most recently
// used, which is harmless: it was just used anyway.
func response(games *match.Store, status int, v any) any {
	b, err := json.Marshal(v)
	if err != nil {
		status, b = 500, []byte(`{"error":"cannot encode the response"}`)
	}
	save := ""
	if st, ok := v.(match.State); ok && status == 200 {
		if m, err := games.Get(st.GameID); err == nil {
			if s, err := json.Marshal(m.Save()); err == nil {
				save = string(s)
			}
		}
	}
	return map[string]any{"status": status, "body": string(b), "save": save}
}
