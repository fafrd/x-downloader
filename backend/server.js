const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const PORT = process.env.PORT || 4455;
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/tmp/tweet-output';

let jobs = {};
let queue = [];
let running = null;
let nextJob = 1;

function ensureOutput() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function broadcast(id) {
  const job = jobs[id];
  if (!job) return;
  const data = JSON.stringify({ job: id, status: job.status, log: job.log, file: job.file || null });
  for (const res of job.clients) {
    res.write(`data: ${data}\n\n`);
  }
}

function startNext() {
  if (running) return;
  const next = queue.shift();
  if (!next) return;
  running = next;
  const { id, url, name } = next;
  ensureOutput();

  jobs[id].status = 'running';
  jobs[id].log = [];
  broadcast(id);

  const proc = spawn('gallery-dl', [
    '--filter', "extension == 'mp4'",
    '-D', OUTPUT_DIR,
    '-f', `${name}.{extension}`,
    url
  ]);
  jobs[id].pid = proc.pid;

  const appendLog = (data) => {
    const line = data.toString().trim();
    if (line) {
      jobs[id].log.push(line);
      broadcast(id);
    }
  };

  proc.stdout.on('data', appendLog);
  proc.stderr.on('data', appendLog);

  proc.on('close', (code) => {
    if (code === 0) {
      jobs[id].status = 'done';
      const mp4 = path.join(OUTPUT_DIR, `${name}.mp4`);
      if (fs.existsSync(mp4)) {
        jobs[id].file = `/output/${name}.mp4`;
      }
    } else {
      jobs[id].status = 'error';
    }
    broadcast(id);
    // close all SSE clients
    for (const res of jobs[id].clients) {
      res.end();
    }
    jobs[id].clients = [];
    running = null;
    startNext();
  });
}

const ALLOWED_URL = /^https?:\/\/(www\.)?(twitter\.com|x\.com|t\.co)\//i;
const ALLOWED_NAME = /^[a-zA-Z0-9_-]{1,100}$/;

app.post('/api/run', (req, res) => {
  const { url, name } = req.body || {};
  if (!url || !name) {
    return res.status(400).json({ error: 'url and name required' });
  }
  if (!ALLOWED_URL.test(url)) {
    return res.status(400).json({ error: 'url must be a twitter.com or x.com link' });
  }
  if (!ALLOWED_NAME.test(name)) {
    return res.status(400).json({ error: 'name must be 1-100 characters: letters, numbers, hyphens, underscores only' });
  }
  ensureOutput();
  const id = nextJob++;
  jobs[id] = { id, url, name, status: 'queued', log: [], clients: [], file: null };
  queue.push({ id, url, name });
  if (!running) startNext();
  res.json({ jobId: id });
});

app.get('/api/stream', (req, res) => {
  const id = parseInt(req.query.job);
  if (!jobs[id]) {
    return res.status(404).json({ error: 'job not found' });
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();

  // Send current state immediately
  const data = JSON.stringify({ job: id, status: jobs[id].status, log: jobs[id].log, file: jobs[id].file || null });
  res.write(`data: ${data}\n\n`);

  if (jobs[id].status === 'done' || jobs[id].status === 'error') {
    res.end();
    return;
  }

  jobs[id].clients.push(res);
  req.on('close', () => {
    jobs[id].clients = jobs[id].clients.filter(c => c !== res);
  });
});

// One-shot download: serve the file then delete it
app.get('/output/:file', (req, res) => {
  const name = req.params.file;
  if (!ALLOWED_NAME.test(path.basename(name, '.mp4')) || !name.endsWith('.mp4')) {
    return res.status(400).end();
  }
  const filePath = path.join(OUTPUT_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.download(filePath, name, (err) => {
    fs.unlink(filePath, () => {});
  });
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://0.0.0.0:${PORT}`);
});
