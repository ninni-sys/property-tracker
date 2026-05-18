'use strict';

const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs   = require('fs');
const net  = require('net');

// ─── Paths ────────────────────────────────────────────────────
// In dev (not packaged) web files live one level up in the repo root.
// In production they are copied to Resources/webapp/ by electron-builder.
const WEB_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'webapp')
  : path.join(__dirname, '..');

// ─── MIME types ───────────────────────────────────────────────
const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.css':   'text/css',
  '.js':    'application/javascript',
  '.json':  'application/json',
  '.png':   'image/png',
  '.ico':   'image/x-icon',
  '.svg':   'image/svg+xml',
  '.webp':  'image/webp',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
};

// Content-Security-Policy for the renderer.
// - GIS script loaded from accounts.google.com
// - Google APIs accessed via fetch from renderer
// - Service worker ('worker-src self') runs from same origin
const CSP = [
  "default-src 'none'",
  "script-src 'self' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://*.googleapis.com https://accounts.google.com https://www.googleapis.com",
  "img-src 'self' data: https:",
  "frame-src https://accounts.google.com",
  "font-src 'self'",
  "worker-src 'self'",
].join('; ');

// ─── Find a free loopback port ────────────────────────────────
function freePort() {
  return new Promise(resolve => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

// ─── Local HTTP server ────────────────────────────────────────
// Serves the static web app from WEB_ROOT over loopback so the
// renderer origin is http://127.0.0.1:PORT — required for Google OAuth
// (GCP accepts http://localhost / http://127.0.0.1 as authorized origins).
function startServer(port) {
  const server = http.createServer((req, res) => {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

    const resolved = path.normalize(path.join(WEB_ROOT, urlPath));

    // Path traversal guard
    if (!resolved.startsWith(WEB_ROOT + path.sep) && resolved !== WEB_ROOT) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(resolved, (err, data) => {
      if (err) {
        // SPA fallback — serve index.html for any unknown path
        fs.readFile(path.join(WEB_ROOT, 'index.html'), (err2, html) => {
          if (err2) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP });
          res.end(html);
        });
        return;
      }
      const ext  = path.extname(resolved).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      const headers = { 'Content-Type': mime };
      if (mime.startsWith('text/html')) headers['Content-Security-Policy'] = CSP;
      res.writeHead(200, headers);
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

// ─── Application menu ─────────────────────────────────────────
function buildMenu(win, port) {
  const isMac = process.platform === 'darwin';
  const appOrigin = `http://127.0.0.1:${port}`;

  const template = [
    // macOS: app-name menu
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),

    {
      label: 'File',
      submenu: [
        {
          label: 'Open in Browser',
          accelerator: isMac ? 'Cmd+Shift+B' : 'Ctrl+Shift+B',
          click: () => shell.openExternal('https://ninni-sys.github.io/property-tracker/'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },

    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },

    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }, { type: 'separator' }]),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    {
      role: 'help',
      submenu: [
        {
          label: `About ${app.name}`,
          click: () => {
            dialog.showMessageBox(win, {
              type:    'info',
              title:   app.name,
              message: `${app.name}  v${app.getVersion()}`,
              detail: [
                'Track rental income, expenses and CGT across your UK properties.',
                '',
                'Data is stored in your own Google Sheets spreadsheet.',
                `Serving from: ${appOrigin}`,
                '',
                'Add http://127.0.0.1 to your Google Cloud project\'s',
                'authorized JavaScript origins to enable sign-in.',
              ].join('\n'),
              buttons: ['OK'],
            });
          },
        },
        { type: 'separator' },
        {
          label: 'Open on GitHub',
          click: () => shell.openExternal('https://github.com/ninni-sys/property-tracker'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── Create window ────────────────────────────────────────────
function createWindow(port) {
  const win = new BrowserWindow({
    width:     1280,
    height:    840,
    minWidth:  900,
    minHeight: 640,
    icon:      path.join(__dirname, '..', 'assets', 'icon.png'),
    // Hidden-inset title bar on Mac keeps the traffic-light buttons
    // inside the window chrome so the header bar can span full width.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
      webSecurity:      true,
      sandbox:          true,
    },
  });

  // Open target=_blank and external navigations in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://127.0.0.1:${port}`)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  buildMenu(win, port);
  win.loadURL(`http://127.0.0.1:${port}/`);
  return win;
}

// ─── App lifecycle ────────────────────────────────────────────
let _port = null;

app.whenReady().then(async () => {
  _port = await freePort();
  await startServer(_port);
  createWindow(_port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(_port);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
