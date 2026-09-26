//go:build js && wasm

// Command mhj2wasm is the practice mode compiled to WebAssembly for the
// static site: the browser (a Web Worker, web/site-public/worker.js) runs the
// sessions itself instead of calling the mhj2 server.
//
// It defines one global function,
//
//	mhj2Request(method, path, body) -> {status, body}
//
// which answers a practice request of the HTTP API (docs/api.md) given as its
// method, path and JSON body, with the status and JSON body the server would
// send.
package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"

	"github.com/litencatt/mhj2/internal/apicall"
	"github.com/litencatt/mhj2/internal/session"
)

func main() {
	store := session.NewStore()
	js.Global().Set("mhj2Request", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 3 {
			return response(400, apicall.ErrorBody("mhj2Request takes method, path and body"))
		}
		return request(store, args[0].String(), args[1].String(), args[2].String())
	}))
	select {} // keep the function callable
}

func request(store *session.Store, method, path, body string) (res any) {
	// A panic would end the Go program and every later call with it.
	defer func() {
		if r := recover(); r != nil {
			res = response(500, apicall.ErrorBody(fmt.Sprint("internal error: ", r)))
		}
	}()
	return response(apicall.Session(store, method, path, strings.NewReader(body)))
}

func response(status int, v any) any {
	b, err := json.Marshal(v)
	if err != nil {
		status, b = 500, []byte(`{"error":"cannot encode the response"}`)
	}
	return map[string]any{"status": status, "body": string(b)}
}
