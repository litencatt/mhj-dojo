// Command mhj-dojo starts the local mahjong practice server and opens the browser.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"github.com/litencatt/mhj-dojo/internal/match"
	"github.com/litencatt/mhj-dojo/internal/server"
	"github.com/litencatt/mhj-dojo/internal/session"
)

func main() {
	port := flag.Int("port", 8765, "port to listen on (0 = random free port)")
	host := flag.String("host", "127.0.0.1", "host to bind")
	open := flag.Bool("open", true, "open the browser")
	seed := flag.Int64("seed", 0, "default wall seed for new sessions (random if unset)")
	flag.Parse()

	store := session.NewStore()
	games := match.NewStore()
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "seed" {
			store.DefaultSeed = seed
			games.DefaultSeed = seed
		}
	})

	if err := run(*host, *port, *open, store, games); err != nil {
		log.Fatal(err)
	}
}

func run(host string, port int, open bool, store *session.Store, games *match.Store) error {
	ln, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return err
	}
	urlHost := host
	if ip := net.ParseIP(host); host == "" || (ip != nil && ip.IsUnspecified()) {
		urlHost = "127.0.0.1"
	}
	url := fmt.Sprintf("http://%s/", net.JoinHostPort(urlHost, strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)))
	fmt.Printf("mhj-dojo listening on %s (Ctrl+C to quit)\n", url)
	if !server.FrontendBuilt() {
		fmt.Fprintln(os.Stderr, "warning: this binary was built without the web frontend, so only the API works; rebuild it with `make build`")
	}
	if addr := ln.Addr().(*net.TCPAddr); !addr.IP.IsLoopback() {
		fmt.Fprintf(os.Stderr, "warning: bound to %s: the API has no authentication and the Host check only stops browsers, so other machines on the network can use it\n", addr)
	}

	srv := &http.Server{
		Handler:           server.New(store, games),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	if open {
		if err := openBrowser(url); err != nil {
			fmt.Fprintf(os.Stderr, "could not open browser: %v\n", err)
		}
	}

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	fmt.Println("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	if err := <-errc; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
