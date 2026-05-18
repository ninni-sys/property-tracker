'use strict';

// Preload — runs in the renderer's context with Node access
// before page scripts, with contextIsolation enforced.
//
// This app is a pure web app. The only thing exposed is platform
// metadata so the renderer can apply OS-specific CSS adjustments.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronApp', {
  platform: process.platform,       // 'darwin' | 'win32' | 'linux'
  version:  process.versions.electron,
});
