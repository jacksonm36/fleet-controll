package main

import (
	"fmt"
	"os"
)

func main() {
	for _, arg := range os.Args[1:] {
		switch arg {
		case "-version", "--version":
			fmt.Println(agentVersionString())
			return
		case "-build", "--build":
			fmt.Println(agentBuildID())
			return
		}
	}
	runAgent()
}
