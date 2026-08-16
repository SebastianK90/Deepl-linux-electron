const {
    app,
    BrowserWindow,
    dialog,
    globalShortcut,
    ipcMain,
    Menu,
    shell,
    nativeImage,
    Tray,
    clipboard,
    session
} = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const store = new Store();
require('@electron/remote/main').initialize();

const appName = 'Deepl-Linux-Electron';

// Disable automation detection flags
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('enable-features', 'NetworkService,NetworkServiceInProcess');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// DO NOT disable UserAgentClientHint — we override sec-ch-ua manually to keep consistency

let win = null;
let tray = null;
let appQuitting = false;
let gShortcut;
let isRemoveLineBreaks = false;
let isHiddenOnStartup = false;
let windowWidth;
let windowHeight;

// Use the exact Chrome version of this Electron build so TLS/JA3 and UA fingerprints match identically
const chromeVersion = process.versions.chrome || '130.0.6723.44';
const chromeMajor = chromeVersion.split('.')[0];
const CLEAN_USER_AGENT = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;

// Track last intended URL so we can return after Cloudflare challenge
let lastIntendedURL = 'https://www.deepl.com/en/translator';
let isOnChallengePage = false;

app.setAboutPanelOptions({
    applicationName: appName,
    applicationVersion: app.getVersion(),
    copyright: '© 2021-2025 kumakichi'
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (win) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
        }
    });
}

function openHotkeySettings() {
    const hotkeySettingsWindow = new BrowserWindow({
        frame: false,
        height: 50,
        width: 280,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            preload: path.join(__static, 'hotkey.js')
        }
    });
    require('@electron/remote/main').enable(hotkeySettingsWindow.webContents);
    hotkeySettingsWindow.loadFile(path.join(__static, 'hotkey.html'));
}

function openWindowSizeSettings() {
    const settingsWindowSize = new BrowserWindow({
        frame: false,
        height: 125,
        width: 200,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            preload: path.join(__static, 'window-size.js')
        }
    });
    require('@electron/remote/main').enable(settingsWindowSize.webContents);
    settingsWindowSize.loadFile(path.join(__static, 'window-size.html'));
}

function injectCleanLayoutCSS(webContents) {
    const cleanCSS = `
        /* Hide unwanted navigation tabs and buttons */
        [data-testid="doctrans-tabs-switch-docs"],
        a[href*="/translator/files"],
        a[href*="/files"],
        [data-testid*="speech"],
        button[aria-label*="speech"],
        a[href*="speech"],
        a[href*="/voice"],
        [data-testid*="voice"],
        a[href*="/pro-api"],
        a[href*="/api"],
        [data-testid*="api"],
        [data-testid="pro-driver-header-pro-button-cta"],
        [data-testid="center-optional-items-outer"],
        [data-testid="product-navigation-sidebar-container"],
        [data-testid="dl-cookieBanner"],
        [data-testid="cookie-banner"],
        .cookieModal,
        #onetrust-consent-sdk,
        div[class*="cookieBanner"],
        aside[aria-label*="banner"] {
            display: none !important;
        }

        /* Harmonized button sizing, padding and font */
        [data-testid="doctrans-tabs-switch-text"],
        [data-testid="doctrans-tabs-switch-write"] {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 6px 16px !important;
            font-size: 14px !important;
            font-weight: 500 !important;
            line-height: 20px !important;
            border-radius: 8px !important;
            cursor: pointer !important;
            text-decoration: none !important;
            box-sizing: border-box !important;
            height: 36px !important;
            min-height: 36px !important;
            margin: 0 2px !important;
        }

        /* Active vs Inactive tab styling */
        [data-testid="doctrans-tabs-switch-text"].is-active,
        [data-testid="doctrans-tabs-switch-write"].is-active {
            background-color: var(--ds-background-surface, #ffffff) !important;
            color: var(--ds-text-primary, #0f2b46) !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
        }

        [data-testid="doctrans-tabs-switch-text"]:not(.is-active),
        [data-testid="doctrans-tabs-switch-write"]:not(.is-active) {
            background-color: transparent !important;
            color: var(--ds-text-muted, #5f6368) !important;
            box-shadow: none !important;
        }

        [data-testid="doctrans-tabs-switch-text"]:not(.is-active):hover,
        [data-testid="doctrans-tabs-switch-write"]:not(.is-active):hover {
            color: var(--ds-text-primary, #0f2b46) !important;
        }
    `;
    webContents.insertCSS(cleanCSS).catch(() => {});
}

function openTranslator() {
    if (!win || win.isDestroyed()) return;
    lastIntendedURL = 'https://www.deepl.com/en/translator';
    const isTranslator = win.webContents.getURL().includes('/translator');
    if (!isTranslator) {
        win.loadURL(lastIntendedURL);
    } else {
        win.webContents.executeJavaScript(`
            (function() {
                const el = document.querySelector('[data-testid="translator-source-input"] [contenteditable="true"], [data-testid="translator-source-input"], div[contenteditable="true"]');
                if (el) el.focus();
            })();
        `).catch(() => {});
    }

    if (!win.isVisible()) win.show();
    win.focus();
}

function openWrite() {
    if (!win || win.isDestroyed()) return;
    lastIntendedURL = 'https://www.deepl.com/en/write';
    const isWrite = win.webContents.getURL().includes('/write');
    if (!isWrite) {
        win.loadURL(lastIntendedURL);
    } else {
        win.webContents.executeJavaScript(`
            (function() {
                const el = document.querySelector('[data-testid="write-editor"] [contenteditable="true"], [data-testid="write-editor"], div[contenteditable="true"]');
                if (el) el.focus();
            })();
        `).catch(() => {});
    }

    if (!win.isVisible()) win.show();
    win.focus();
}

function registerShortcut(newShortcut, oldShortcut) {
    let shortcut = globalShortcut.register(newShortcut, () => {
        translateClipboard(isRemoveLineBreaks);
        if (win) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
        }
    });

    if (!shortcut) {
        messageBox("error", "Register shortcut fail", `You will not be able to use ${newShortcut}`);
        return false;
    }

    if (oldShortcut) {
        globalShortcut.unregister(oldShortcut);
    }
    gShortcut = newShortcut;
    return true;
}

function messageBox(type, title, message) {
    dialog.showMessageBoxSync({
        type: type,
        title: title,
        message: message,
        buttons: ["OK"]
    });
}

function translateClipboard(isChecked) {
    if (!win || win.isDestroyed()) return;
    let txt = clipboard.readText();
    if (!txt) return;
    if (isChecked) {
        txt = txt.split("\n").join(" ");
    }

    const script = `
    (function(textToInsert) {
        function findInputTarget() {
            const isWrite = window.location.pathname.includes('/write');

            const writeSelectors = [
                '[data-testid="write-editor"] [contenteditable="true"]',
                '[data-testid="write-editor"]',
                '.write-editor [contenteditable="true"]',
                '[data-testid="write-source-input"] [contenteditable="true"]',
                '[data-testid="write-source-input"]',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"]'
            ];

            const translatorSelectors = [
                '[data-testid="translator-source-input"] [contenteditable="true"]',
                '[data-testid="translator-source-input"]',
                'd-textarea [contenteditable="true"]',
                'd-textarea textarea',
                'section[aria-label*="Source"] [contenteditable="true"]',
                'section[aria-label*="Quelle"] [contenteditable="true"]',
                'd-textarea',
                'div[role="textbox"]',
                'textarea'
            ];

            const selectors = isWrite
                ? writeSelectors.concat(translatorSelectors)
                : translatorSelectors.concat(writeSelectors);

            for (let i = 0; i < selectors.length; i++) {
                const el = document.querySelector(selectors[i]);
                if (el) {
                    if (el.shadowRoot) {
                        const inner = el.shadowRoot.querySelector('[contenteditable="true"], textarea');
                        if (inner) return inner;
                    }
                    return el;
                }
            }
            return null;
        }

        const el = findInputTarget();
        if (!el) {
            console.warn('DeepL input target not found');
            return false;
        }

        el.focus();

        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            el.value = textToInsert;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
            const selection = window.getSelection();
            if (selection) {
                const range = document.createRange();
                range.selectNodeContents(el);
                selection.removeAllRanges();
                selection.addRange(range);
            }

            let inserted = false;
            try {
                inserted = document.execCommand('insertText', false, textToInsert);
            } catch (e) {
                console.error(e);
            }

            if (!inserted || (el.innerText || '').trim() !== textToInsert.trim()) {
                el.innerText = textToInsert;
                el.dispatchEvent(new InputEvent('input', {
                    bubbles: true,
                    composed: true,
                    inputType: 'insertText',
                    data: textToInsert
                }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }

        if ('value' in el) {
            el.value = textToInsert;
            el.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                composed: true,
                inputType: 'insertFromPaste',
                data: textToInsert
            }));
            return true;
        }

        return false;
    })(${JSON.stringify(txt)});
    `;

    win.webContents.executeJavaScript(script).catch(err => {
        console.error('Failed to insert clipboard text into DeepL:', err);
    });
}

app.on('ready', function() {
    isRemoveLineBreaks = store.get('remove_line_breaks') || false;
    isHiddenOnStartup = store.get('hidden_on_startup') || false;
    windowWidth = store.get('window_width');
    windowHeight = store.get('window_height');

    // Use persistent partition for DeepL session and cookies
    const ses = session.fromPartition('persist:deepl');

    app.userAgentFallback = CLEAN_USER_AGENT;
    ses.setUserAgent(CLEAN_USER_AGENT);
    session.defaultSession.setUserAgent(CLEAN_USER_AGENT);

    // Persist and flush Cloudflare clearance & DeepL session cookies immediately
    ses.cookies.on('changed', (event, cookie, cause, removed) => {
        ses.cookies.flushStore().catch(() => {});
        // When cf_clearance cookie appears and we're on a challenge page, navigate back
        if (!removed && cookie.name === 'cf_clearance' && isOnChallengePage) {
            console.log('cf_clearance cookie received, redirecting to:', lastIntendedURL);
            isOnChallengePage = false;
            setTimeout(() => {
                if (win && !win.isDestroyed()) {
                    win.loadURL(lastIntendedURL);
                }
            }, 1500);
        }
    });

    // Rewrite sec-ch-ua headers so they match a real Chrome ${chromeMajor} instead of leaking Electron
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
        const { requestHeaders } = details;
        requestHeaders['User-Agent'] = CLEAN_USER_AGENT;
        // Override Client Hints to match real Chrome exactly
        requestHeaders['sec-ch-ua'] = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not?A_Brand";v="99"`;
        requestHeaders['sec-ch-ua-mobile'] = '?0';
        requestHeaders['sec-ch-ua-platform'] = '"Linux"';
        if (!requestHeaders['Accept-Language']) {
            requestHeaders['Accept-Language'] = 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7';
        }
        delete requestHeaders['X-DevTools-Emulate-Network-Conditions-Client-Id'];
        callback({ cancel: false, requestHeaders });
    });

    // Detect Cloudflare challenge pages via response headers
    ses.webRequest.onHeadersReceived((details, callback) => {
        const { responseHeaders, url } = details;
        if (responseHeaders) {
            const cfMitigated = responseHeaders['cf-mitigated'] || responseHeaders['Cf-Mitigated'];
            if (cfMitigated && cfMitigated.some(v => v.toLowerCase().includes('challenge'))) {
                console.log('Cloudflare challenge detected for:', url);
                isOnChallengePage = true;
            }
        }
        callback({ cancel: false, responseHeaders });
    });

    const templateArr = [
        {
            label: 'Mode',
            submenu: [
                {
                    label: 'DeepL Translator',
                    accelerator: 'CmdOrCtrl+1',
                    click: () => openTranslator()
                },
                {
                    label: 'DeepL Write',
                    accelerator: 'CmdOrCtrl+2',
                    click: () => openWrite()
                },
                { type: 'separator' },
                {
                    label: 'Back',
                    accelerator: 'Alt+Left',
                    click: () => {
                        if (win && win.webContents.canGoBack()) win.webContents.goBack();
                    }
                },
                {
                    label: 'Forward',
                    accelerator: 'Alt+Right',
                    click: () => {
                        if (win && win.webContents.canGoForward()) win.webContents.goForward();
                    }
                },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    role: 'reload'
                }
            ]
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
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
                { role: 'toggleDevTools' }
            ]
        },
        {
            label: 'Settings',
            submenu: [
                {
                    label: 'Shortcut',
                    click: () => openHotkeySettings()
                },
                {
                    label: 'Window size',
                    click: () => openWindowSizeSettings()
                },
                {
                    label: 'Remove Line Breaks',
                    type: 'checkbox',
                    checked: isRemoveLineBreaks,
                    click: (item) => {
                        isRemoveLineBreaks = item.checked;
                        store.set('remove_line_breaks', isRemoveLineBreaks);
                        translateClipboard(item.checked);
                    }
                },
                {
                    label: 'Hidden on startup',
                    type: 'checkbox',
                    checked: isHiddenOnStartup,
                    click: (item) => {
                        isHiddenOnStartup = item.checked;
                        store.set('hidden_on_startup', isHiddenOnStartup);
                    }
                },
                { type: 'separator' },
                {
                    label: 'Quit',
                    role: 'quit'
                }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'DeepL Help Center',
                    click: async () => {
                        await shell.openExternal('https://support.deepl.com');
                    }
                },
                {
                    label: 'Learn More',
                    click: async () => {
                        await shell.openExternal('https://github.com/kumakichi/Deepl-linux-electron');
                    }
                },
                {
                    label: 'About',
                    click: async () => {
                        await app.showAboutPanel();
                    }
                }
            ]
        }
    ];

    if (process.platform === 'darwin') {
        templateArr.unshift({
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
                { role: 'quit' }
            ]
        });
    }

    const menu = Menu.buildFromTemplate(templateArr);
    Menu.setApplicationMenu(menu);

    tray = new Tray(nativeImage.createFromPath(path.join(__static, 'tray-icon.png')));
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show / Hide',
            click() {
                if (win.isVisible()) {
                    win.hide();
                } else {
                    win.show();
                    win.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'DeepL Translator',
            click() {
                openTranslator();
            }
        },
        {
            label: 'DeepL Write',
            click() {
                openWrite();
            }
        },
        { type: 'separator' },
        {
            label: 'Settings',
            submenu: [
                {
                    label: 'Shortcut',
                    click: () => openHotkeySettings()
                },
                {
                    label: 'Window size',
                    click: () => openWindowSizeSettings()
                }
            ]
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click() {
                appQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.setToolTip('DeepL Linux');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
        if (win.isVisible()) {
            win.hide();
        } else {
            win.show();
            win.focus();
        }
    });

    let ss = store.get('short_key');
    if (!ss) {
        store.set('short_key', 'Control+Alt+C');
    }
    gShortcut = store.get('short_key');
    registerShortcut(gShortcut);

    win = new BrowserWindow({
        title: 'DeepL',
        width: parseInt(windowWidth, 10) || 1000,
        height: parseInt(windowHeight, 10) || 750,
        minWidth: 480,
        minHeight: 400,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            spellcheck: true,
            partition: 'persist:deepl',
            preload: path.join(__static, 'preload.js')
        },
        show: !isHiddenOnStartup
    });

    if (windowWidth && windowHeight) {
        win.setSize(parseInt(windowWidth, 10), parseInt(windowHeight, 10), false);
    }

    win.webContents.setUserAgent(CLEAN_USER_AGENT);

    lastIntendedURL = 'https://www.deepl.com/en/translator';
    win.loadURL(lastIntendedURL);

    win.on('close', function(evt) {
        const currentSes = session.fromPartition('persist:deepl');
        currentSes.cookies.flushStore().catch(() => {});
        if (!appQuitting) {
            evt.preventDefault();
            win.hide();
        }
    });

    win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
        if (targetUrl.includes('deepl.com/write') || targetUrl.includes('deepl.com/translator') || targetUrl.includes('deepl.com/de/write') || targetUrl.includes('deepl.com/en/write')) {
            win.loadURL(targetUrl);
            return { action: 'deny' };
        }
        if (targetUrl.includes('deepl.com') || targetUrl.includes('cloudflare.com')) {
            return { action: 'allow' };
        }
        shell.openExternal(targetUrl);
        return { action: 'deny' };
    });

    win.webContents.on('will-navigate', (event, navigationUrl) => {
        try {
            const parsed = new URL(navigationUrl);
            // Block navigation to external sites
            if (!parsed.hostname.endsWith('deepl.com') && !parsed.hostname.endsWith('cloudflare.com')) {
                event.preventDefault();
                shell.openExternal(navigationUrl);
                return;
            }
            // Track intended DeepL URLs for post-challenge redirect
            if (parsed.hostname.endsWith('deepl.com') && (navigationUrl.includes('/translator') || navigationUrl.includes('/write'))) {
                lastIntendedURL = navigationUrl;
            }
        } catch (e) {
            // ignore
        }
    });

    win.webContents.on('did-finish-load', () => {
        const currentUrl = win.webContents.getURL();

        // Detect Cloudflare challenge page by URL pattern or page title
        if (currentUrl.includes('/cdn-cgi/') || currentUrl.includes('challenges.cloudflare.com')) {
            console.log('On Cloudflare challenge page, waiting for user to solve...');
            isOnChallengePage = true;
            return;
        }

        // Check page title for Cloudflare indicators
        const title = win.webContents.getTitle();
        if (title && (title.includes('Just a moment') || title.includes('Attention Required'))) {
            console.log('Cloudflare interstitial detected via title:', title);
            isOnChallengePage = true;
            return;
        }

        // Only inject our customizations on actual DeepL pages
        if (currentUrl.includes('deepl.com')) {
            isOnChallengePage = false;
            injectCleanLayoutCSS(win.webContents);

            const appConfigPath = path.join(app.getPath('appData'), appName);
            const cssPath = path.join(appConfigPath, 'user_theme.css');
            if (fs.existsSync(cssPath)) {
                fs.readFile(cssPath, 'utf8', (err, data) => {
                    if (!err && data && data.trim().length > 0) {
                        console.log('Applying custom CSS file length:', data.length);
                        win.webContents.insertCSS(data).catch(err => {
                            console.error('Failed to apply CSS:', err);
                        });
                    }
                });
            }
        }
    });
});

app.on('before-quit', () => {
    const currentSes = session.fromPartition('persist:deepl');
    currentSes.cookies.flushStore().catch(() => {});
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

ipcMain.on('set-hotkey', (event, arg) => {
    console.log('Got new hotkey:', arg);
    if (!registerShortcut(arg, gShortcut)) {
        event.reply('set-hotkey-reply', false);
        return;
    }
    store.set('short_key', arg);
    event.reply('set-hotkey-reply', true, arg);
});

ipcMain.on('set-window-size', (event, argWidth, argHeight) => {
    console.log('Got new window size:', argWidth, 'x', argHeight);
    store.set('window_width', argWidth);
    store.set('window_height', argHeight);
    event.reply('set-window-size-reply', true, argWidth, argHeight);
    if (win) {
        win.setSize(parseInt(argWidth, 10), parseInt(argHeight, 10), true);
    }
});
