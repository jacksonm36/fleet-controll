package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

func postJobLog(cli *http.Client, base, token, jobID, message string) error {
	body := map[string]any{"message": message}
	var discard map[string]any
	return postJSON(
		cli,
		joinURL(base, fmt.Sprintf("/api/agent/v1/jobs/%s/log", jobID)),
		body,
		token,
		&discard,
	)
}

func completeJob(cli *http.Client, base, token, jobID, status, msg string) error {
	body := map[string]any{"status": status}
	if msg != "" {
		body["errorMessage"] = msg
	}
	var discard map[string]any
	return postJSON(
		cli,
		joinURL(base, fmt.Sprintf("/api/agent/v1/jobs/%s/complete", jobID)),
		body,
		token,
		&discard,
	)
}

func runJob(cli *http.Client, base, token string, job *jobRecord, sudo bool) {
	logFn := func(line string) {
		if err := postJobLog(cli, base, token, job.ID, line); err != nil {
			log.Printf("job log failed: %v", err)
		}
	}

	fail := func(err error) {
		if err == nil {
			return
		}
		logFn(fmt.Sprintf("error: %v", err))
		_ = completeJob(cli, base, token, job.ID, "FAILED", err.Error())
	}

	defer func() {
		if r := recover(); r != nil {
			msg := fmt.Sprintf("panic: %v", r)
			logFn(msg)
			_ = completeJob(cli, base, token, job.ID, "FAILED", msg)
		}
	}()

	logFn(fmt.Sprintf("starting job type=%s", job.Type))

	switch job.Type {
	case "PACKAGE_REFRESH":
		logFn("Refreshing inventory snapshot…")
		inv, err := collectInventory(sudo)
		if err != nil {
			fail(err)
			return
		}
		var discard map[string]any
		if err := postJSON(cli, joinURL(base, "/api/agent/v1/inventory"), inv, token, &discard); err != nil {
			fail(err)
			return
		}
		logFn("Inventory refresh pushed.")
	case "PACKAGE_PATCH_PLAN":
		result, err := runPackagePatchPlan(job.Payload, sudo, logFn)
		if err != nil {
			fail(err)
			return
		}
		if err := completeJobWithResult(cli, base, token, job.ID, "COMPLETED", "", result); err != nil {
			log.Printf("complete job failed: %v", err)
		}
		return
	case "HOST_KERNEL_MAINTENANCE":
		result, err := runHostKernelMaintenance(job.Payload, sudo, logFn)
		if err != nil {
			fail(err)
			return
		}
		if inv, invErr := collectInventory(sudo); invErr != nil {
			logFn(fmt.Sprintf("warning: post-kernel inventory collect: %v", invErr))
		} else {
			var discard map[string]any
			if pushErr := postJSON(cli, joinURL(base, "/api/agent/v1/inventory"), inv, token, &discard); pushErr != nil {
				logFn(fmt.Sprintf("warning: post-kernel inventory push: %v", pushErr))
			} else {
				logFn("Inventory pushed to controller (kernel status updated)")
				if k, ok := inv["kernel"].(map[string]any); ok {
					logFn(fmt.Sprintf("Kernel now: running=%v installed=%v updatePending=%v",
						k["running"], k["latestInstalled"], k["updatePending"]))
				}
			}
		}
		if err := completeJobWithResult(cli, base, token, job.ID, "COMPLETED", "", result); err != nil {
			log.Printf("complete job failed: %v", err)
		}
		return
	case "PACKAGE_UPGRADE":
		result, err := runPackageUpgradeWithRefresh(cli, base, token, job.Payload, sudo, logFn)
		if err != nil {
			if result.UpgradedCount > 0 {
				_ = completeJobWithResult(cli, base, token, job.ID, "FAILED", err.Error(), result)
			} else {
				fail(err)
			}
			return
		}
		if err := completeJobWithResult(cli, base, token, job.ID, "COMPLETED", "", result); err != nil {
			log.Printf("complete job failed: %v", err)
		}
		return
	case "SERVICE_RESTART", "SERVICE_STOP", "SERVICE_START":
		if err := runServiceAction(job.Type, job.Payload, sudo, logFn); err != nil {
			fail(err)
			return
		}
	case "CROWDSEC_DECISION_ADD":
		if err := runCrowdSecDecision(job.Payload, sudo, logFn); err != nil {
			fail(err)
			return
		}
	case "SHELL_SCRIPT":
		if err := runShellScript(job.Payload, sudo, logFn); err != nil {
			fail(err)
			return
		}
	case "ANSIBLE_PLAYBOOK":
		if err := runAnsiblePlaybook(job.Payload, sudo, logFn); err != nil {
			fail(err)
			return
		}
	case "ANSIBLE_ADHOC":
		if err := runAnsibleAdhoc(job.Payload, sudo, logFn); err != nil {
			fail(err)
			return
		}
	case "TERRAFORM_INIT", "TERRAFORM_PLAN", "TERRAFORM_APPLY":
		if err := runTerraformJob(job.Type, job.Payload, sudo, logFn); err != nil {
			fail(err)
			return
		}
	default:
		fail(fmt.Errorf("unsupported job type %s", job.Type))
		return
	}

	if err := completeJob(cli, base, token, job.ID, "COMPLETED", ""); err != nil {
		log.Printf("complete job failed: %v", err)
	}
}

func runServiceAction(jobType string, payload json.RawMessage, sudo bool, logFn func(string)) error {
	var p map[string]any
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	name, _ := p["unitOrServiceName"].(string)
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("missing unitOrServiceName")
	}

	switch runtime.GOOS {
	case "linux":
		var verb string
		switch jobType {
		case "SERVICE_RESTART":
			verb = "restart"
		case "SERVICE_STOP":
			verb = "stop"
		case "SERVICE_START":
			verb = "start"
		default:
			return fmt.Errorf("unknown service job")
		}
		logFn(fmt.Sprintf("systemctl %s %s", verb, name))
		return streamCommand(logFn, sudo, "systemctl", []string{verb, name})
	case "windows":
		var psVerb string
		switch jobType {
		case "SERVICE_RESTART":
			psVerb = "Restart-Service"
		case "SERVICE_STOP":
			psVerb = "Stop-Service"
		case "SERVICE_START":
			psVerb = "Start-Service"
		default:
			return fmt.Errorf("unknown service job")
		}
		escaped := strings.ReplaceAll(name, `"`, `\"`)
		cmd := fmt.Sprintf("%s -Name \"%s\" -Force", psVerb, escaped)
		logFn(fmt.Sprintf("powershell %s %s", psVerb, name))
		return streamCommand(logFn, false, "powershell", []string{"-NoProfile", "-Command", cmd})
	default:
		return fmt.Errorf("unsupported GOOS")
	}
}

func runCrowdSecDecision(payload json.RawMessage, sudo bool, logFn func(string)) error {
	var p map[string]any
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	ip, _ := p["ip"].(string)
	if strings.TrimSpace(ip) == "" {
		return fmt.Errorf("missing ip")
	}
	duration, _ := p["duration"].(string)
	if strings.TrimSpace(duration) == "" {
		duration = "4h"
	}
	reason, _ := p["reason"].(string)

	cscli, err := exec.LookPath("cscli")
	if err != nil {
		return fmt.Errorf("cscli not found on PATH")
	}

	args := []string{"decisions", "add", "--ip", ip, "--duration", duration}
	if strings.TrimSpace(reason) != "" {
		args = append(args, "--reason", reason)
	}

	logFn(fmt.Sprintf("%s %s", cscli, strings.Join(args, " ")))
	return streamCommand(logFn, sudo, cscli, args)
}

func configureCommandEnv(cmd *exec.Cmd) {
	cmd.Env = append(os.Environ(),
		"DEBIAN_FRONTEND=noninteractive",
		"NEEDRESTART_MODE=a",
		"APT_LISTCHANGES_FRONTEND=none",
		"UCF_FORCE_CONFOLD=1",
	)
}

func streamCommand(logFn func(string), sudo bool, name string, args []string) error {
	cmd := exec.Command(name, args...)
	if sudo && runtime.GOOS == "linux" && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", name}, args...)...)
	}
	configureCommandEnv(cmd)

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

	copyLines := func(r io.Reader, prefix string) {
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

	done := make(chan struct{})
	go func() {
		copyLines(stdout, "")
		close(done)
	}()
	copyLines(stderr, "[stderr] ")
	<-done

	return cmd.Wait()
}

func streamCommandCapture(logFn func(string), sudo bool, name string, args []string) (string, error) {
	cmd := exec.Command(name, args...)
	if sudo && runtime.GOOS == "linux" && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", name}, args...)...)
	}
	configureCommandEnv(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}

	if err := cmd.Start(); err != nil {
		return "", err
	}

	var captured strings.Builder
	copyLines := func(r io.Reader, prefix string) {
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
					captured.WriteString(line)
					captured.WriteByte('\n')
					logFn(prefix + line)
				}
			}
			if readErr != nil {
				if strings.TrimSpace(acc) != "" {
					captured.WriteString(strings.TrimSpace(acc))
					captured.WriteByte('\n')
					logFn(prefix + strings.TrimSpace(acc))
				}
				break
			}
		}
	}

	done := make(chan struct{})
	go func() {
		copyLines(stdout, "")
		close(done)
	}()
	copyLines(stderr, "[stderr] ")
	<-done

	err = cmd.Wait()
	return captured.String(), err
}
