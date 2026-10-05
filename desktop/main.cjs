// Windows версия на „Балкански легенди“: същата игра в собствен прозорец на цял екран (F11 превключва).
const { app, BrowserWindow, Menu, shell } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..', 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

// Малък вътрешен сървър (ES модулите не се зареждат от file://). Винаги на един и същ порт,
// за да се пазят записите (IndexedDB и настройките са вързани за адреса).
function serve(port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let p;
      try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
      // локалният ИИ (Ollama) — препращане, за да няма CORS проблеми
      if (p.startsWith('/__ollama/')) return proxyOllama(req, res, req.url.slice('/__ollama'.length));
      if (p === '/' || p === '') p = '/index.html';
      const file = path.join(ROOT, path.normalize(p));
      if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('404'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      });
    });
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve(srv.address().port));
  });
}

function proxyOllama(req, res, rest) {
  const up = http.request({ host: '127.0.0.1', port: 11434, path: rest || '/', method: req.method,
    headers: { 'content-type': req.headers['content-type'] || 'application/json' } }, (r) => {
    res.writeHead(r.statusCode || 502, { 'Content-Type': r.headers['content-type'] || 'application/json' });
    r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
}

// 3D играта иска истинската видеокарта (на лаптопите има и вградена)
app.commandLine.appendSwitch('force_high_performance_gpu');
// звукът тръгва и без първо щракване (WebAudio)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// само един прозорец на играта (втори .exe само показва първия)
const single = app.requestSingleInstanceLock();
if (!single) app.quit();

let win = null;
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  if (!single) return;
  Menu.setApplicationMenu(null);
  let port;
  try { port = await serve(47871); } catch { port = await serve(0); }
  win = new BrowserWindow({
    width: 1600, height: 900, fullscreen: true, backgroundColor: '#14100c', title: 'Балкански легенди',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { backgroundThrottling: false },
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12' && input.control && input.shift) win.webContents.toggleDevTools();
  });
  // външни връзки (напр. „Свали Ollama“) — в браузъра на системата, не в прозореца на играта
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(`http://127.0.0.1:${port}`)) shell.openExternal(url);
    return { action: 'deny' };
  });
  await win.loadURL(`http://127.0.0.1:${port}/?app=desktop`);
});
app.on('window-all-closed', () => app.quit());
