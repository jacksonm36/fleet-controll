package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

func joinURL(base, p string) string {
	b := strings.TrimRight(base, "/")
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return b + p
}

func postJSON(cli *http.Client, url string, body any, bearer string, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	res, err := cli.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}

	if res.StatusCode >= 300 {
		return fmt.Errorf("http %d: %s", res.StatusCode, string(raw))
	}

	if out != nil && len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return err
		}
	}
	return nil
}

func fetchNextJob(cli *http.Client, base, token string) (*jobRecord, int, error) {
	req, err := http.NewRequest(http.MethodGet, joinURL(base, "/api/agent/v1/commands"), nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	res, err := cli.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusNoContent {
		return nil, res.StatusCode, nil
	}
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		return nil, res.StatusCode, fmt.Errorf("unexpected status %d: %s", res.StatusCode, string(b))
	}

	var job jobRecord
	if err := json.NewDecoder(res.Body).Decode(&job); err != nil {
		return nil, res.StatusCode, err
	}
	return &job, res.StatusCode, nil
}
