package main

import "runtime"

func goArch() string {
	return runtime.GOARCH
}
