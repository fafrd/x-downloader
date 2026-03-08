# tweet-to-mp4

A small web app for downloading videos from Twitter/X as MP4s.
Paste a tweet URL, give the file a name, click Download — the browser's native
download prompt fires automatically and the file is deleted from the server
immediately after transfer.

Deployed on [Fly.io](https://fly.io) with scale-to-zero (no idle cost).

## Stack

| Layer | What |
|---|---|
| Frontend | Plain HTML/JS (`frontend/index.html`) served as static files by Express |
| Backend | Node.js + Express (`backend/server.js`) on port 8080 |
| Downloader | `gallery-dl` (installed in Docker image) |
| Hosting | Fly.io — single shared-CPU-1x 256 MB machine, scales to zero when idle |

## Directory layout

```
tweet-to-mp4/
  frontend/
    index.html          # Single-page UI
  backend/
    server.js           # Express API + static file serving
    package.json
  Dockerfile
  fly.toml
  README.md
```

## How it works

1. User submits a twitter.com / x.com URL and a filename via the form.
2. `POST /api/run` queues a job. Jobs run one at a time (serial queue).
3. The backend spawns `gallery-dl --filter "extension == 'mp4'" -D /tmp/tweet-output -f <name>.{extension} <url>`.
4. `GET /api/stream?job=<id>` opens a Server-Sent Events connection; stdout/stderr
   from gallery-dl streams to the browser in real time.
5. On success, `GET /output/<name>.mp4` serves the file via `res.download()` and
   immediately `unlink`s it — files do not persist on disk.

## Deploy to Fly.io

### First deploy

```bash
fly auth login
fly launch --no-deploy   # creates the app; fly.toml is already present
fly deploy
```

### Subsequent deploys

```bash
fly deploy
```

### Useful commands

```bash
fly logs              # tail live logs
fly status            # machine status
fly ssh console       # shell into the running machine
```

## Test locally with Docker

```bash
docker build -t tweet-to-mp4 .
docker run --rm -p 8080:8080 tweet-to-mp4
# open http://localhost:8080
```

## Input validation (security)

- `url` must match `^https?://(www\.)?(twitter\.com|x\.com|t\.co)/`
- `name` must match `^[a-zA-Z0-9_-]{1,100}$` — enforced on both the `/api/run`
  endpoint and the `/output/:file` download endpoint to prevent path traversal

## Known limitations / future work

- No authentication — the API is open. Add Fly.io access controls or a proxy
  auth layer before sharing publicly.
- Jobs run serially. Parallel downloads are not supported.
- The `jobs` object is in-memory and never pruned — a restart clears stale entries.
  Fly.io machines restart on deploy, so this is usually fine.
