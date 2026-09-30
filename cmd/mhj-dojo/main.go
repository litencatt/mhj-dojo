// Command mhj-dojo serves the mahjong practice app (the static site's build,
// its engine running in the browser) on this machine and opens the browser.
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

	"github.com/litencatt/mhj-dojo/internal/server"
)

func main() {
	port := flag.Int("port", 8765, "port to listen on (0 = random free port)")
	host := flag.String("host", "127.0.0.1", "host to bind")
	open := flag.Bool("open", true, "open the browser")
	seed := flag.Int64("seed", 0, "open practice on this wall seed (/?seed=N; random if unset)")
	flag.Parse()

	page := "/"
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "seed" {
			page = "/?seed=" + strconv.FormatInt(*seed, 10)
		}
	})

	if err := run(*host, *port, *open, page); err != nil {
		log.Fatal(err)
	}
}

// run serves the app until interrupted, printing (and with open, opening)
// the URL of page on it.
func run(host string, port int, open bool, page string) error {
	ln, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return err
	}
	urlHost := host
	if ip := net.ParseIP(host); host == "" || (ip != nil && ip.IsUnspecified()) {
		urlHost = "127.0.0.1"
	}
	url := fmt.Sprintf("http://%s%s", net.JoinHostPort(urlHost, strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)), page)
	fmt.Printf("mhj-dojo listening on %s (Ctrl+C to quit)\n", url)
	if !server.FrontendBuilt() {
		fmt.Fprintln(os.Stderr, "warning: this binary was built without the web frontend, so there is nothing to play; rebuild it with `make build`")
	}
	if addr := ln.Addr().(*net.TCPAddr); !addr.IP.IsLoopback() {
		fmt.Fprintf(os.Stderr, "warning: bound to %s, but it only answers requests for localhost, so browsers on other machines can't open it\n", addr)
	}

	srv := &http.Server{
		Handler:           server.New(),
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
