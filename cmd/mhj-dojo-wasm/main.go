//go:build js && wasm

// Command mhj-dojo-wasm is the practice mode compiled to WebAssembly for the
// static site: the browser (a Web Worker, web/site-public/worker.js) runs the
// sessions itself instead of calling the mhj-dojo server.
//
// It defines two global functions:
//
//	mhjDojoRequest(method, path, body) -> {status, body}
//
// answers a practice request of the HTTP API (docs/api.md) given as its
// method, path and JSON body, with the status and JSON body the server would
// send (apicall.Route), and
//
//	mhjDojoRestore(body) -> {status, body}
//
// rebuilds a session from its moves in one call after a page reload
// (apicall.Restore; not an HTTP endpoint).
package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"

	"github.com/litencatt/mhj-dojo/internal/apicall"
	"github.com/litencatt/mhj-dojo/internal/session"
)

// maxSessions bounds the engine's in-memory sessions much tighter than the
// native server's session.MaxSessions (256): this runs in a browser tab's
// memory, and each practice session (its branch tree plus its own
// yakushanten.Analyzer memo) can hold several MB, never released by Go's
// wasm runtime back to the OS (docs/api.md "Memory"). 4 is enough for the
// one game actually being played plus room to return to a couple of others
// by URL without forcing a rebuild; web/e2e-site/practice.spec.ts asserts
// eviction past this cap and its rebuild-from-save, so keep the two in sync.
const maxSessions = 4

func main() {
	store := session.NewStoreWithMax(maxSessions)
	js.Global().Set("mhjDojoRequest", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 3 {
			return response(400, apicall.ErrorBody("mhjDojoRequest takes method, path and body"))
		}
		return safely(func() (int, any) {
			return apicall.Route(store, args[0].String(), args[1].String(), strings.NewReader(args[2].String()))
		})
	}))
	js.Global().Set("mhjDojoRestore", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 {
			return response(400, apicall.ErrorBody("mhjDojoRestore takes a body"))
		}
		return safely(func() (int, any) {
			return apicall.Restore(store, strings.NewReader(args[0].String()))
		})
	}))
	select {} // keep the function callable
}

// safely runs f, turning a panic into a 500: a panic would end the Go
// program and every later call with it.
func safely(f func() (int, any)) (res any) {
	defer func() {
		if r := recover(); r != nil {
			res = response(500, apicall.ErrorBody(fmt.Sprint("internal error: ", r)))
		}
	}()
	return response(f())
}

func response(status int, v any) any {
	b, err := json.Marshal(v)
	if err != nil {
		status, b = 500, []byte(`{"error":"cannot encode the response"}`)
	}
	return map[string]any{"status": status, "body": string(b)}
}
