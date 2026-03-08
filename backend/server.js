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
  const { id, url, name, format } = next;
  ensureOutput();

  jobs[id].status = 'running';
  jobs[id].log = [];
  broadcast(id);

  const appendLog = (data) => {
    const line = data.toString().trim();
    if (line) {
      jobs[id].log.push(line);
      broadcast(id);
    }
  };

  const finishJob = (status, file) => {
    jobs[id].status = status;
    if (file) jobs[id].file = file;
    broadcast(id);
    for (const res of jobs[id].clients) res.end();
    jobs[id].clients = [];
    running = null;
    startNext();
  };

  const mp4Path = path.join(OUTPUT_DIR, `${name}.mp4`);
  const gifPath = path.join(OUTPUT_DIR, `${name}.gif`);

  const proc = spawn('gallery-dl', [
    '--filter', "extension == 'mp4'",
    '-D', OUTPUT_DIR,
    '-f', `${name}.{extension}`,
    url
  ]);
  jobs[id].pid = proc.pid;

  proc.stdout.on('data', appendLog);
  proc.stderr.on('data', appendLog);

  proc.on('close', (code) => {
    if (code !== 0) return finishJob('error');

    if (format === 'mp4') {
      const file = fs.existsSync(mp4Path) ? `/output/${name}.mp4` : null;
      return finishJob('done', file);
    }

    // Convert mp4 -> gif with ffmpeg (two-pass: palette file avoids split filter OOM)
    const palettePath = path.join(OUTPUT_DIR, `${name}_palette.png`);
    const pass1 = spawn('ffmpeg', [
      '-y', '-i', mp4Path,
      '-vf', 'fps=15,scale=480:-1:flags=lanczos,palettegen',
      palettePath
    ]);
    pass1.stdout.on('data', appendLog);
    pass1.stderr.on('data', appendLog);
    pass1.on('close', (p1Code) => {
      if (p1Code !== 0) {
        fs.unlink(mp4Path, () => {});
        return finishJob('error');
      }
      const pass2 = spawn('ffmpeg', [
        '-y', '-i', mp4Path, '-i', palettePath,
        '-filter_complex', 'fps=15,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse',
        '-loop', '0',
        gifPath
      ]);
      pass2.stdout.on('data', appendLog);
      pass2.stderr.on('data', appendLog);
      pass2.on('close', (p2Code) => {
        fs.unlink(mp4Path, () => {});
        fs.unlink(palettePath, () => {});
        if (p2Code !== 0) return finishJob('error');
        const file = fs.existsSync(gifPath) ? `/output/${name}.gif` : null;
        finishJob('done', file);
      });
    });
  });
}

const ALLOWED_URL = /^https?:\/\/(www\.)?(twitter\.com|x\.com|t\.co)\//i;
const ALLOWED_NAME = /^[a-zA-Z0-9_-]{1,100}$/;

app.post('/api/run', (req, res) => {
  const { url, name, format } = req.body || {};
  if (!url || !name) {
    return res.status(400).json({ error: 'url and name required' });
  }
  if (!ALLOWED_URL.test(url)) {
    return res.status(400).json({ error: 'url must be a twitter.com or x.com link' });
  }
  if (!ALLOWED_NAME.test(name)) {
    return res.status(400).json({ error: 'name must be 1-100 characters: letters, numbers, hyphens, underscores only' });
  }
  const fmt = format === 'gif' ? 'gif' : 'mp4';
  ensureOutput();
  const id = nextJob++;
  jobs[id] = { id, url, name, format: fmt, status: 'queued', log: [], clients: [], file: null };
  queue.push({ id, url, name, format: fmt });
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
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  if (!ALLOWED_NAME.test(base) || !['.mp4', '.gif'].includes(ext)) {
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
