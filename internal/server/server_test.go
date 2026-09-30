package server

import (
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

type client struct {
	t   *testing.T
	srv *httptest.Server
}

func newClient(t *testing.T) *client {
	static := fstest.MapFS{
		"index.html":             {Data: []byte("<!doctype html><title>mhj-dojo</title>")},
		"assets/app-C2ZR0Mrc.js": {Data: []byte("console.log(1)")},
		"assets/logo.svg":        {Data: []byte("<svg")},
		"info/index.html":        {Data: []byte("<!doctype html><title>更新情報</title>")},
		"mhj-dojo.wasm":          {Data: []byte("\x00asm\x01\x00\x00\x00")},
		"worker.js":              {Data: []byte("importScripts('wasm_exec.js')")},
		"wasm_exec.js":           {Data: []byte("globalThis.Go = class {}")},
		"version.json":           {Data: []byte(`{"version":"dev"}`)},
		"manifest.webmanifest":   {Data: []byte(`{"name":"mhj-dojo"}`)},
	}
	srv := httptest.NewServer(NewWithFS(static))
	t.Cleanup(srv.Close)
	return &client{t: t, srv: srv}
}

func (c *client) do(method, path, body string) (int, []byte, http.Header) {
	c.t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req, _ := http.NewRequest(method, c.srv.URL+path, r)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, b, res.Header
}

func TestStaticAndSPAFallback(t *testing.T) {
	c := newClient(t)
	const (
		html      = "text/html; charset=utf-8"
		js        = "text/javascript; charset=utf-8"
		noCache   = "no-cache"
		immutable = "public, max-age=31536000, immutable"
	)
	for path, want := range map[string]struct{ body, contentType, cache string }{
		"/":                       {"<!doctype html>", html, noCache},
		"/practice":               {"<!doctype html><title>mhj-dojo", html, noCache}, // an unknown page
		"/assets/app-C2ZR0Mrc.js": {"console.log", js, immutable},
		"/assets/logo.svg":        {"<svg", "image/svg+xml", noCache}, // not named by its hash
		"/info/":                  {"<!doctype html><title>更新情報", html, noCache},
		"/info":                   {"<!doctype html><title>更新情報", html, noCache}, // redirected to /info/
		"/mhj-dojo.wasm?v=abc":    {"\x00asm", "application/wasm", noCache},
		"/worker.js?v=abc":        {"importScripts", js, noCache},
		"/wasm_exec.js?v=abc":     {"globalThis.Go", js, noCache},
		"/version.json?t=1":       {`{"version"`, "application/json", noCache},
		"/manifest.webmanifest":   {`{"name"`, "application/manifest+json", noCache},
	} {
		code, b, h := c.do("GET", path, "")
		if code != http.StatusOK || !strings.HasPrefix(string(b), want.body) || h.Get("Content-Type") != want.contentType || h.Get("Cache-Control") != want.cache || h.Get("ETag") == "" {
			t.Errorf("GET %s: %d %q %q %q %q, want %q %q", path, code, b, h.Get("Content-Type"), h.Get("Cache-Control"), h.Get("ETag"), want.contentType, want.cache)
		}
	}
	// index.html served at a deeper path would load its relative assets from
	// the wrong place.
	for _, path := range []string{"/assets/missing-C2ZR0Mrc.js", "/assets/", "/some/spa/path", "/info/missing", "/api"} {
		if code, b, _ := c.do("GET", path, ""); code != http.StatusNotFound {
			t.Errorf("GET %s: %d %q, want 404", path, code, b)
		}
	}
	if code, _, _ := c.do("POST", "/", "x"); code != http.StatusMethodNotAllowed {
		t.Errorf("POST /: %d", code)
	}
}

// A reload revalidates the engine and the pages by their ETags instead of
// fetching them again.
func TestStaticETag(t *testing.T) {
	c := newClient(t)
	for _, path := range []string{"/mhj-dojo.wasm?v=abc", "/worker.js?v=abc", "/", "/info/", "/practice"} {
		code, _, h := c.do("GET", path, "")
		etag := h.Get("ETag")
		if code != http.StatusOK || etag == "" {
			t.Fatalf("GET %s: %d, ETag %q", path, code, etag)
		}
		req, _ := http.NewRequest("GET", c.srv.URL+path, nil)
		req.Header.Set("If-None-Match", etag)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = res.Body.Close()
		if res.StatusCode != http.StatusNotModified {
			t.Errorf("GET %s with If-None-Match %s: %d, want 304", path, etag, res.StatusCode)
		}
	}
	_, _, wasm := c.do("GET", "/mhj-dojo.wasm", "")
	_, _, worker := c.do("GET", "/worker.js", "")
	if wasm.Get("ETag") == worker.Get("ETag") {
		t.Errorf("mhj-dojo.wasm and worker.js share the ETag %s", wasm.Get("ETag"))
	}
}

// TestEmbeddedFrontend checks what this binary serves: the static site's
// build after make embed (as in CI's site job, which drives it in the
// browser), the not-built page otherwise (as in the Go test jobs and
// `go install`).
func TestEmbeddedFrontend(t *testing.T) {
	srv := httptest.NewServer(New())
	defer srv.Close()
	res, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	b, _ := io.ReadAll(res.Body)
	want := "<title>mhj-dojo - 画面が組み込まれていません</title>"
	if FrontendBuilt() {
		want = "<title>mhj-dojo - 麻雀道場</title>"
	}
	if res.StatusCode != http.StatusOK || !strings.Contains(string(b), want) {
		t.Fatalf("embedded index (built %v): %d %q", FrontendBuilt(), res.StatusCode, b)
	}
	if !FrontendBuilt() {
		return
	}
	// The static site's build (make embed), its engine included.
	for _, name := range []string{"mhj-dojo.wasm", "wasm_exec.js", "worker.js", "version.json", "info/index.html"} {
		if !isFile(staticFS, "static/dist/"+name) {
			t.Errorf("static/dist/%s is missing: not the site build?", name)
		}
	}
}

func TestFrontend(t *testing.T) {
	notbuilt := &fstest.MapFile{Data: []byte("not built")}
	for _, tc := range []struct {
		name string
		fsys fstest.MapFS
		want string
	}{
		{"built", fstest.MapFS{"static/dist/index.html": {Data: []byte("app")}, "static/notbuilt/index.html": notbuilt}, "app"},
		{"not built", fstest.MapFS{"static/notbuilt/index.html": notbuilt}, "not built"},
		{"dist without index", fstest.MapFS{"static/dist/assets/app.js": {}, "static/notbuilt/index.html": notbuilt}, "not built"},
	} {
		b, err := fs.ReadFile(frontend(tc.fsys), "index.html")
		if err != nil || string(b) != tc.want {
			t.Errorf("%s: index.html = %q, %v; want %q", tc.name, b, err, tc.want)
		}
	}
}

// The API is gone (issue #147): a plain 404, never the page.
func TestNoAPI(t *testing.T) {
	c := newClient(t)
	for _, r := range []struct{ method, path string }{
		{"GET", "/api"}, {"GET", "/api/version"}, {"GET", "/api/changelog"}, {"POST", "/api/sessions"}, {"POST", "/api/games/x/action"},
	} {
		code, b, h := c.do(r.method, r.path, "{}")
		if code != http.StatusNotFound || strings.Contains(string(b), "<title>") || !strings.HasPrefix(h.Get("Content-Type"), "text/plain") {
			t.Errorf("%s %s: %d %q %q", r.method, r.path, code, h.Get("Content-Type"), b)
		}
	}
}

// Only a loopback Host is served: another site's page can't reach the app
// through DNS rebinding.
func TestGuards(t *testing.T) {
	c := newClient(t)
	for _, tc := range []struct {
		host string
		want int
	}{
		{"", http.StatusOK},
		{"localhost:8765", http.StatusOK},
		{"LOCALHOST", http.StatusOK},
		{"[::1]:8765", http.StatusOK},
		{"127.0.0.1", http.StatusOK},
		{"127.0.0.2:8765", http.StatusOK},
		{"evil.example:8765", http.StatusForbidden},
		{"evil.example", http.StatusForbidden},
		{"192.168.1.10:8765", http.StatusForbidden},
		{"localhost.evil.example", http.StatusForbidden},
	} {
		req, _ := http.NewRequest("GET", c.srv.URL+"/", nil)
		if tc.host != "" {
			req.Host = tc.host
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = res.Body.Close()
		if res.StatusCode != tc.want {
			t.Errorf("host=%q: %d, want %d", tc.host, res.StatusCode, tc.want)
		}
	}
}

func TestSecurityHeaders(t *testing.T) {
	c := newClient(t)
	check := func(what string, h http.Header) {
		t.Helper()
		if h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Content-Security-Policy") != "frame-ancestors 'none'" || h.Get("X-Frame-Options") != "DENY" {
			t.Errorf("%s: headers %v", what, h)
		}
	}
	for _, path := range []string{"/", "/info/", "/assets/app-C2ZR0Mrc.js", "/api/sessions/nope", "/some/spa/path"} {
		_, _, h := c.do("GET", path, "")
		check(path, h)
	}
	// Rejected requests carry them too.
	req, _ := http.NewRequest("GET", c.srv.URL+"/", nil)
	req.Host = "evil.example"
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("spoofed host: %d", res.StatusCode)
	}
	check("403", res.Header)
}
