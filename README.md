# tweet-to-mp4

A small self-hosted web app for downloading videos from Twitter/X as MP4s.
Paste a tweet URL, give the file a name, click Download — the browser's native
download prompt fires automatically and the file is deleted from the server
immediately after transfer.

## Stack

| Layer | What |
|---|---|
| Frontend | Plain HTML/JS (`frontend/index.html`) served by nginx |
| Backend | Node.js + Express (`backend/server.js`) on port 4456 |
| Downloader | `gallery-dl` (system binary, must be on PATH) |
| Web server | nginx — serves static frontend, reverse-proxies `/api/` and `/output/` |
| Process manager | systemd (`tweet-backend.service`) |

## Directory layout

```
/srv/tweet/
  frontend/
    index.html          # Single-page UI
  backend/
    server.js           # Express API
    package.json
    node_modules/
  output/               # Temporary MP4 staging (auto-deleted after download)
  nginx.conf            # Source of truth for nginx config
  README.md
```

## How it works

1. User submits a twitter.com / x.com URL and a filename via the form.
2. `POST /api/run` queues a job. Jobs run one at a time (serial queue).
3. The backend spawns `gallery-dl --filter "extension == 'mp4'" -D /srv/tweet/output -f <name>.{extension} <url>`.
4. `GET /api/stream?job=<id>` opens a Server-Sent Events connection; stdout/stderr
   from gallery-dl streams to the browser in real time.
5. On success, `GET /output/<name>.mp4` serves the file via `res.download()` and
   immediately `unlink`s it — files do not persist on disk.

## Nginx config

Source of truth is `/srv/tweet/nginx.conf`. It is symlinked into nginx:

```
/etc/nginx/sites-enabled/tweet -> /etc/nginx/sites-available/tweet
```

To apply changes:

```bash
cp /srv/tweet/nginx.conf /etc/nginx/sites-available/tweet
nginx -t && systemctl reload nginx
```

## systemd service

```
/etc/systemd/system/tweet-backend.service
```

Useful commands:

```bash
systemctl status tweet-backend
systemctl restart tweet-backend
journalctl -u tweet-backend -f
```

To apply changes to the service file:

```bash
systemctl daemon-reload && systemctl restart tweet-backend
```

## Backend — after code changes

```bash
cd /srv/tweet/backend
npm install          # if dependencies changed
systemctl restart tweet-backend
```

## Input validation (security)

- `url` must match `^https?://(www\.)?(twitter\.com|x\.com|t\.co)/`
- `name` must match `^[a-zA-Z0-9_-]{1,100}$` — enforced on both the `/api/run`
  endpoint and the `/output/:file` download endpoint to prevent path traversal

## Known limitations / future work

- No authentication — the API is open. Suitable for a private/Tailscale-only
  VPS; add a reverse-proxy auth layer (e.g. nginx `auth_basic` or Tailscale ACLs)
  before exposing publicly.
- Jobs run serially. Parallel downloads are not supported.
- The `jobs` object is in-memory and never pruned — a long-running server will
  accumulate stale job entries. A restart clears them.
- The process runs as root. A dedicated `tweet` system user with ownership of
  `/srv/tweet/output` and `/srv/tweet/backend/node_modules` would be safer.
