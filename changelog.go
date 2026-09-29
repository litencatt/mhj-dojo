// Package mhjdojo holds the repository's own files that the programs embed.
package mhjdojo

import _ "embed"

// Changelog is CHANGELOG.md, which tagpr updates on every release. The
// local server hands it to the 更新情報 page (GET /api/changelog, web/info).
//
//go:embed CHANGELOG.md
var Changelog string
