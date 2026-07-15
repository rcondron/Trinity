/**
 * Trinity desktop overlay — a transparent, frameless, always-on-top,
 * click-through window covering the work area, in which the avatar walks
 * around on your screen (web app in ?platform=overlay mode).
 *
 * Tray menu: toggle interactivity (so you can use the mic / chat), quit.
 * Dev default loads the Vite dev server; set TRINITY_AVATAR_URL to override
 * (e.g. the built dist — see the start:built script).
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, globalShortcut } = require('electron');

const URL = process.env.TRINITY_AVATAR_URL || 'http://localhost:5173/?platform=overlay';

let win = null;
let tray = null;
let interactive = false;

function setInteractive(on) {
  interactive = on;
  if (!win) return;
  // forward:true keeps mousemove events flowing so the page can react
  // even while clicks pass through to whatever is underneath.
  win.setIgnoreMouseEvents(!on, { forward: true });
  win.setFocusable(on);
  if (on) win.focus();
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    ...workArea,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadURL(URL);
  setInteractive(false);

  win.on('closed', () => {
    win = null;
  });
}

function createTray() {
  // 16×16 green dot, generated inline so no asset file is needed.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAdElEQVQ4y2NgGAWDHzAyMDAw/P//' +
      'n4EYwMTAwMDw//9/PBqxq2ViYGBgYGRkxKMRuxwTAwMDAyMjIwMDAwMDIyMjTo3Y5ZgYGBgYGBkZ' +
      '8WrELsfEwMDAwMjIiFcjdjkmBgYGBkZGRoIascsNAgAAiVkPJ/kMdOEAAAAASUVORK5CYII=',
    'base64',
  );
  tray = new Tray(nativeImage.createFromBuffer(png));
  tray.setToolTip('Trinity Avatar overlay');
  const rebuild = () => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: interactive ? 'Make click-through' : 'Make interactive (talk to Trinity)',
          click: () => {
            setInteractive(!interactive);
            rebuild();
          },
        },
        { label: 'Reload', click: () => win?.reload() },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
  };
  rebuild();
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  // Ctrl/Cmd+Shift+T toggles interactivity without reaching for the tray.
  globalShortcut.register('CommandOrControl+Shift+T', () => setInteractive(!interactive));
});

app.on('window-all-closed', () => app.quit());
