# Operations

## After code changes on the controller

```bash
bash scripts/restart-fleet-services.sh
```

Rebuilds API (esbuild), web (if production `.next` exists), and restarts `fleet-api`, `fleet-web`, and `nginx`.

## Agent binary changes

```bash
bash scripts/rebuild-fleet-agent.sh
# Push to online agents from the UI or API
```
