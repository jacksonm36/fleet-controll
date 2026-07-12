package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func runShellScript(payload json.RawMessage, sudo bool, logFn func(string)) error {
	var p map[string]any
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	script, _ := p["script"].(string)
	if strings.TrimSpace(script) == "" {
		return fmt.Errorf("missing script")
	}
	cwd, _ := p["cwd"].(string)
	if strings.TrimSpace(cwd) == "" {
		cwd = "/tmp"
	}
	interpreter, _ := p["interpreter"].(string)
	if strings.TrimSpace(interpreter) == "" {
		if runtime.GOOS == "windows" {
			interpreter = "powershell"
		} else {
			interpreter = "/bin/bash"
		}
	}

	timeoutSec := 600.0
	if v, ok := p["timeoutSec"].(float64); ok && v > 0 {
		timeoutSec = v
	}

	if err := os.MkdirAll(cwd, 0o755); err != nil {
		return fmt.Errorf("cwd: %w", err)
	}

	logFn(fmt.Sprintf("shell cwd=%s interpreter=%s timeout=%ds", cwd, interpreter, int(timeoutSec)))

	switch runtime.GOOS {
	case "windows":
		if strings.EqualFold(interpreter, "powershell") || strings.HasSuffix(interpreter, "powershell.exe") {
			return streamCommandWithTimeout(logFn, false, "powershell", []string{
				"-NoProfile", "-NonInteractive", "-Command", script,
			}, time.Duration(timeoutSec)*time.Second)
		}
		return streamCommandWithTimeout(logFn, false, interpreter, []string{"-c", script}, time.Duration(timeoutSec)*time.Second)
	default:
		if strings.Contains(script, "\n") || strings.HasPrefix(strings.TrimSpace(script), "#!") {
			tmp, err := os.CreateTemp(cwd, "fleet-script-*.sh")
			if err != nil {
				return err
			}
			name := tmp.Name()
			defer os.Remove(name)
			body := script
			if !strings.HasPrefix(strings.TrimSpace(body), "#!") {
				body = "#!/usr/bin/env bash\nset -euo pipefail\n" + body
			}
			if _, err := tmp.WriteString(body); err != nil {
				tmp.Close()
				return err
			}
			if err := tmp.Chmod(0o755); err != nil {
				tmp.Close()
				return err
			}
			if err := tmp.Close(); err != nil {
				return err
			}
			logFn(fmt.Sprintf("executing %s via %s", name, interpreter))
			return streamCommandWithTimeout(logFn, sudo, interpreter, []string{name}, time.Duration(timeoutSec)*time.Second)
		}
		return streamCommandWithTimeout(logFn, sudo, interpreter, []string{"-c", script}, time.Duration(timeoutSec)*time.Second)
	}
}

func runAnsiblePlaybook(payload json.RawMessage, sudo bool, logFn func(string)) error {
	var p map[string]any
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	yaml, _ := p["playbookYaml"].(string)
	if strings.TrimSpace(yaml) == "" {
		return fmt.Errorf("missing playbookYaml")
	}
	inventory, _ := p["inventory"].(string)
	if strings.TrimSpace(inventory) == "" {
		inventory = "localhost,"
	}
	checkMode, _ := p["checkMode"].(bool)

	ansible, err := exec.LookPath("ansible-playbook")
	if err != nil {
		logFn("ansible-playbook not found; installing...")
		if installErr := ensureAnsible(sudo); installErr != nil {
			return fmt.Errorf("ansible-playbook not found and auto-install failed: %w", installErr)
		}
		ansible, err = exec.LookPath("ansible-playbook")
		if err != nil {
			return fmt.Errorf("ansible-playbook still not found after install")
		}
	}

	dir, err := os.MkdirTemp("", "fleet-ansible-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	playbookPath := filepath.Join(dir, "playbook.yml")
	if err := os.WriteFile(playbookPath, []byte(yaml), 0o644); err != nil {
		return err
	}

	args := []string{playbookPath, "-i", inventory}
	if checkMode {
		args = append(args, "--check")
	}
	if ev, ok := p["extraVars"].(map[string]any); ok && len(ev) > 0 {
		b, _ := json.Marshal(ev)
		varsPath := filepath.Join(dir, "extra-vars.json")
		if err := os.WriteFile(varsPath, b, 0o644); err != nil {
			return err
		}
		args = append(args, "-e", "@"+varsPath)
	}

	logFn(fmt.Sprintf("%s %s", ansible, strings.Join(args, " ")))
	return streamCommand(logFn, sudo, ansible, args)
}

func runAnsibleAdhoc(payload json.RawMessage, sudo bool, logFn func(string)) error {
	var p map[string]any
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	module, _ := p["module"].(string)
	if strings.TrimSpace(module) == "" {
		module = "ping"
	}
	args, _ := p["args"].(string)
	if strings.TrimSpace(args) == "" {
		args = "all"
	}
	inventory, _ := p["inventory"].(string)
	if strings.TrimSpace(inventory) == "" {
		inventory = "localhost,"
	}

	ansible, err := exec.LookPath("ansible")
	if err != nil {
		logFn("ansible not found; installing...")
		if installErr := ensureAnsible(sudo); installErr != nil {
			return fmt.Errorf("ansible not found and auto-install failed: %w", installErr)
		}
		ansible, err = exec.LookPath("ansible")
		if err != nil {
			return fmt.Errorf("ansible still not found after install")
		}
	}

	cmdArgs := []string{inventory, "-m", module, "-a", args}
	logFn(fmt.Sprintf("%s %s", ansible, strings.Join(cmdArgs, " ")))
	return streamCommand(logFn, sudo, ansible, cmdArgs)
}

func runTerraformJob(jobType string, payload json.RawMessage, sudo bool, logFn func(string)) error {
	var p map[string]any
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	workDir, _ := p["workingDir"].(string)
	if strings.TrimSpace(workDir) == "" {
		workDir = "/tmp/fleet-terraform"
	}
	hcl, _ := p["configHcl"].(string)
	useTofu, _ := p["useOpenTofu"].(bool)
	autoApprove, _ := p["autoApprove"].(bool)

	bin := "terraform"
	if useTofu {
		if p, err := exec.LookPath("tofu"); err == nil {
			bin = p
		} else {
			return fmt.Errorf("opentofu (tofu) not found on PATH")
		}
	} else {
		p, err := exec.LookPath("terraform")
		if err != nil {
			logFn("terraform not found; installing...")
			if installErr := ensureTerraform(sudo); installErr != nil {
				return fmt.Errorf("terraform not found and auto-install failed: %w", installErr)
			}
			p, err = exec.LookPath("terraform")
			if err != nil {
				return fmt.Errorf("terraform still not found after install")
			}
		}
		bin = p
	}

	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return err
	}
	if strings.TrimSpace(hcl) != "" {
		mainTf := filepath.Join(workDir, "main.tf")
		if err := os.WriteFile(mainTf, []byte(hcl), 0o644); err != nil {
			return err
		}
		logFn(fmt.Sprintf("wrote %s", mainTf))
	}

	var verb string
	switch jobType {
	case "TERRAFORM_INIT":
		verb = "init"
	case "TERRAFORM_PLAN":
		verb = "plan"
	case "TERRAFORM_APPLY":
		verb = "apply"
	default:
		return fmt.Errorf("unknown terraform job %s", jobType)
	}

	args := []string{verb, "-no-color"}
	if verb == "apply" && autoApprove {
		args = append(args, "-auto-approve")
	}
	if vf, ok := p["varFiles"].([]any); ok {
		for _, item := range vf {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				args = append(args, "-var-file="+s)
			}
		}
	}

	logFn(fmt.Sprintf("cd %s && %s %s", workDir, bin, strings.Join(args, " ")))
	return streamCommandInDir(logFn, sudo, bin, args, workDir)
}

func streamCommandWithTimeout(logFn func(string), sudo bool, name string, args []string, timeout time.Duration) error {
	done := make(chan error, 1)
	go func() {
		done <- streamCommand(logFn, sudo, name, args)
	}()
	select {
	case err := <-done:
		return err
	case <-time.After(timeout):
		return fmt.Errorf("command timed out after %s", timeout)
	}
}

func streamCommandInDir(logFn func(string), sudo bool, name string, args []string, dir string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	if sudo && runtime.GOOS == "linux" && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", name}, args...)...)
		cmd.Dir = dir
	}
	// Reuse streamCommand by setting stdout/stderr - duplicate minimal logic
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	pipeLines(stdout, stderr, logFn)
	return cmd.Wait()
}

func pipeLines(stdout, stderr interface{ Read([]byte) (int, error) }, logFn func(string)) {
	readPipe := func(r interface{ Read([]byte) (int, error) }, prefix string) {
		buf := make([]byte, 4096)
		acc := ""
		for {
			n, readErr := r.Read(buf)
			if n > 0 {
				acc += string(buf[:n])
				for {
					idx := strings.IndexByte(acc, '\n')
					if idx == -1 {
						break
					}
					line := strings.TrimRight(acc[:idx], "\r")
					acc = acc[idx+1:]
					logFn(prefix + line)
				}
			}
			if readErr != nil {
				if strings.TrimSpace(acc) != "" {
					logFn(prefix + strings.TrimSpace(acc))
				}
				break
			}
		}
	}
	go readPipe(stdout, "")
	readPipe(stderr, "[stderr] ")
}
