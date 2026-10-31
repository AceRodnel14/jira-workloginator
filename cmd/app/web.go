package main

import (
	"io/fs"

	"gitlab.com/acerodnel/jira-workloginator/web"
)

// Backend + frontend build: serve the embedded Vite build (web/dist).
func init() {
	dist, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		panic(err)
	}
	static = dist
}
