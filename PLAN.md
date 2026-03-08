# Plan: migrate to Fly.io (scale-to-zero)

## Goal
Remove the self-hosted VPS in favour of a Fly.io app that scales to zero when
idle. No nginx to manage, no systemd, no SSH. Existing Node/Express backend and
plain-HTML frontend stay essentially unchanged.

## What changes

| | Now (VPS) | After (Fly.io) |
|---|---|---|
| Process manager | systemd | Fly machine (auto-restart built in) |
| Web server | nginx (reverse proxy) | Removed — Node listens on 0.0.0.0:8080 directly |
| gallery-dl | system package | Installed in Docker image |
| Config | nginx.conf + service file | Dockerfile + fly.toml |
| Scale-to-zero | No | Yes (min_machines_running = 0) |

## Steps

1. **Dockerfile** — multi-stage or single stage:
   - Base: `node:20-slim`
   - Install Python + pip + gallery-dl
   - Copy backend, run `npm ci`
   - Copy frontend
   - Expose port 8080
   - Serve frontend as static files directly from Express (no nginx)

2. **Backend changes** — minor:
   - Serve `frontend/index.html` (and any future static assets) via `express.static`
   - Default port to `8080` (Fly convention)
   - Remove nginx-specific header (`X-Accel-Buffering`) — not needed without nginx

3. **fly.toml**:
   - `min_machines_running = 0` (scale to zero)
   - HTTP service on internal port 8080
   - Health check on `/`
   - Single shared-CPU-1x 256MB machine (plenty for this workload)

4. **Remove nginx.conf** from the repo (no longer needed).

5. **Update README** with Fly.io deploy instructions.

6. **Test locally** with `docker build` + `docker run` before deploying.

## What stays the same
- All input validation (url, name allowlists)
- SSE progress streaming
- One-shot download + delete
- Serial job queue
- `gallery-dl` invocation and flags
