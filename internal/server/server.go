// Package server serves the embedded frontend: the static site's build, whose
// engine runs in the browser (there is no API).
package server

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"path"
	"regexp"
	"strings"
	"time"
)

// static/dist is the built frontend, the static site (make embed; not
// committed), and static/notbuilt the page served in its place by a binary
// built without it, such as one from `go install`.
//
//go:embed all:static
var staticFS embed.FS

func init() {
	// Go's mime package doesn't know this extension (it has no OS mime.types
	// entry), so http.FileServerFS would otherwise serve the manifest as
	// text/plain.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

// New returns the HTTP handler for the embedded frontend.
func New() http.Handler {
	return NewWithFS(frontend(staticFS))
}

// FrontendBuilt reports whether the binary embeds the built frontend.
func FrontendBuilt() bool {
	return isFile(staticFS, "static/dist/index.html")
}

// frontend is the built frontend in fsys's static/dist, or the static/notbuilt
// page if it has none.
func frontend(fsys fs.FS) fs.FS {
	dir := "static/dist"
	if !isFile(fsys, dir+"/index.html") {
		dir = "static/notbuilt"
	}
	sub, err := fs.Sub(fsys, dir)
	if err != nil {
		panic(err)
	}
	return sub
}

// NewWithFS is New with an explicit frontend file system (for tests).
func NewWithFS(static fs.FS) http.Handler {
	mux := http.NewServeMux()
	// The API the page used before its engine moved into the browser (issue
	// #147): gone, and never the page's fallback.
	mux.Handle("/api", http.NotFoundHandler())
	mux.Handle("/api/", http.NotFoundHandler())
	mux.Handle("/", spa(static))
	return guard(mux)
}

// guard rejects requests whose Host is not a loopback name (DNS rebinding:
// another site's page reading the app, or its saves in this origin's
// storage), and sets the response headers that keep other origins from
// embedding the app. It is a browser-side defence only: a network client can
// send any Host.
func guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		// Other origins may not frame the app (clickjacking a discard).
		h.Set("Content-Security-Policy", "frame-ancestors 'none'")
		h.Set("X-Frame-Options", "DENY")
		if !loopbackHost(r.Host) {
			http.Error(w, "host not allowed: "+r.Host, http.StatusForbidden)
			return
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

// spa serves static files and falls back to index.html for unknown paths
// at the top level (/?mode=game has no path of its own, but an old link
// might). A directory with its own index.html (info/, the 更新情報 page) is
// a page too: the file server serves /info/ and redirects /info there.
// Anything else is a 404: the build's paths are relative (base './'), so
// index.html served at a deeper path would load its assets from the wrong
// place.
//
// The build's hashed assets (assets/index-C2ZR0Mrc.js) never change, so a
// browser keeps them for good; anything else (the pages, version.json, the
// engine, which the page loads as worker.js?v=<hash> and so on) it checks
// with the server on every load, by its ETag, so a reload only fetches what
// a new binary's build changed.
func spa(static fs.FS) http.Handler {
	files := http.FileServerFS(static)
	etags := etags(static)
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
		w.Header().Set("Cache-Control", "no-cache")
		st, err := fs.Stat(static, name)
		if err == nil && st.IsDir() {
			name = path.Join(name, "index.html")
			st, err = fs.Stat(static, name)
		}
		if err == nil && !st.IsDir() {
			if hashedAsset.MatchString(name) {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			w.Header().Set("ETag", etags[name])
			files.ServeHTTP(w, r)
			return
		}
		index, err := fs.ReadFile(static, "index.html")
		if strings.Contains(name, "/") || err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("ETag", etags["index.html"])
		http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(index))
	})
}

// hashedAsset matches the build's files named by their content hash.
var hashedAsset = regexp.MustCompile(`^assets/[^/]*-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$`)

// etags is each file's ETag in fsys: a hash of its content.
func etags(fsys fs.FS) map[string]string {
	m := map[string]string{}
	err := fs.WalkDir(fsys, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := fs.ReadFile(fsys, name)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(b)
		m[name] = `"` + hex.EncodeToString(sum[:8]) + `"`
		return nil
	})
	if err != nil {
		panic(err)
	}
	return m
}

func isFile(fsys fs.FS, name string) bool {
	st, err := fs.Stat(fsys, name)
	return err == nil && !st.IsDir()
}
