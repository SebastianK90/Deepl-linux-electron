const { webFrame } = require('electron');

// 1. Synchronous stealth patch for Cloudflare Turnstile & bot detection
try {
    delete Object.getPrototypeOf(navigator).webdriver;
} catch (e) {}

try {
    webFrame.executeJavaScript(`
        (function() {
            // Delete navigator.webdriver from prototype and object
            try {
                delete Object.getPrototypeOf(navigator).webdriver;
            } catch (e) {}
            try {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined,
                    configurable: true
                });
            } catch (e) {}

            // Override navigator.userAgentData to remove Electron brand
            try {
                const chromeVersion = /Chrome\\/([\\d.]+)/.exec(navigator.userAgent);
                const major = chromeVersion ? chromeVersion[1].split('.')[0] : '130';
                const fakeBrands = [
                    { brand: 'Chromium', version: major },
                    { brand: 'Google Chrome', version: major },
                    { brand: 'Not?A_Brand', version: '99' }
                ];
                const fakeUAData = {
                    brands: fakeBrands,
                    mobile: false,
                    platform: 'Linux',
                    getHighEntropyValues: function(hints) {
                        return Promise.resolve({
                            brands: fakeBrands,
                            mobile: false,
                            platform: 'Linux',
                            platformVersion: '6.1.0',
                            architecture: 'x86',
                            bitness: '64',
                            model: '',
                            uaFullVersion: chromeVersion ? chromeVersion[1] : '130.0.6723.44',
                            fullVersionList: fakeBrands.map(b => ({ brand: b.brand, version: chromeVersion ? chromeVersion[1] : '130.0.6723.44' }))
                        });
                    }
                };
                Object.defineProperty(navigator, 'userAgentData', {
                    get: () => fakeUAData,
                    configurable: true
                });
            } catch (e) {}

            // Mock window.chrome runtime & app objects
            if (!window.chrome) {
                window.chrome = {};
            }
            if (!window.chrome.app) {
                window.chrome.app = {
                    isInstalled: false,
                    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
                };
            }
            if (!window.chrome.runtime) {
                window.chrome.runtime = {
                    OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
                    OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
                    PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                    PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                    PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
                    RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }
                };
            }
            if (!window.chrome.loadTimes) {
                window.chrome.loadTimes = function() {
                    return {
                        commitLoadTime: Date.now() / 1000,
                        connectionInfo: 'http/1.1',
                        finishDocumentLoadTime: Date.now() / 1000,
                        finishLoadTime: Date.now() / 1000,
                        firstPaintAfterLoadTime: 0,
                        firstPaintTime: Date.now() / 1000,
                        navigationType: 'Other',
                        npnNegotiatedProtocol: 'h2',
                        requestTime: Date.now() / 1000,
                        startLoadTime: Date.now() / 1000,
                        wasAlternateProtocolAvailable: false,
                        wasFetchedViaSpdy: true,
                        wasNpnNegotiated: true
                    };
                };
            }
            if (!window.chrome.csi) {
                window.chrome.csi = function() {
                    return {
                        onloadT: Date.now(),
                        pageT: Date.now() - performance.timing.navigationStart,
                        startE: performance.timing.navigationStart,
                        tran: 15
                    };
                };
            }

            // Fix permissions query for notifications
            if (navigator.permissions && navigator.permissions.query) {
                const origQuery = navigator.permissions.query;
                navigator.permissions.query = function(parameters) {
                    if (parameters && parameters.name === 'notifications') {
                        return Promise.resolve({
                            state: typeof Notification !== 'undefined' ? Notification.permission : 'default',
                            onchange: null
                        });
                    }
                    return origQuery.apply(this, arguments);
                };
            }
        })();
    `);
} catch (e) {
    console.error('Stealth preload error:', e);
}

// 2. DOM Harmonization: Ensure ONLY "Translate text" and "DeepL Write" appear in the header with perfect styles
function harmonizeHeaderNavigation() {
    const isWrite = window.location.pathname.includes('/write');

    // Hide unwanted tabs and clutter (speech, voice, files, API, marketing, cookies)
    const hideSelectors = [
        '[data-testid="doctrans-tabs-switch-docs"]',
        'a[href*="/translator/files"]',
        'a[href*="/files"]',
        '[data-testid*="speech"]',
        'button[aria-label*="speech"]',
        'a[href*="speech"]',
        'a[href*="/voice"]',
        '[data-testid*="voice"]',
        'a[href*="/pro-api"]',
        'a[href*="/api"]',
        '[data-testid*="api"]',
        '[data-testid="pro-driver-header-pro-button-cta"]',
        '[data-testid="center-optional-items-outer"]',
        '[data-testid="product-navigation-sidebar-container"]',
        '[data-testid="dl-cookieBanner"]',
        '[data-testid="cookie-banner"]',
        '.cookieModal',
        '#onetrust-consent-sdk',
        'div[class*="cookieBanner"]'
    ];

    document.querySelectorAll(hideSelectors.join(',')).forEach(el => {
        el.style.setProperty('display', 'none', 'important');
    });

    // Locate the tab element specifically in the tablist
    const textTab = document.querySelector('[data-testid="doctrans-tabs-switch-text"]');
    if (textTab && textTab.parentElement) {
        const tabContainer = textTab.parentElement;

        // Check if write tab already exists in this tabContainer
        let writeTab = tabContainer.querySelector('[data-testid="doctrans-tabs-switch-write"]');
        if (!writeTab) {
            writeTab = tabContainer.querySelector('a[aria-labelledby="write-tab-heading"], a[href*="/write"]');
            if (writeTab) {
                writeTab.setAttribute('data-testid', 'doctrans-tabs-switch-write');
            }
        }

        if (!writeTab) {
            writeTab = document.createElement('a');
            writeTab.className = textTab.className;
            writeTab.setAttribute('href', '/en/write');
            writeTab.setAttribute('data-testid', 'doctrans-tabs-switch-write');
            writeTab.setAttribute('data-dui-component', 'Button');
            writeTab.innerHTML = '<span class="__content with-content-center"><span>DeepL Write</span></span>';
            writeTab.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = '/en/write';
            });
            tabContainer.appendChild(writeTab);
        }

        // Apply clean and consistent button classes and active state
        if (isWrite) {
            textTab.classList.remove('is-active');
            writeTab.classList.add('is-active');
        } else {
            writeTab.classList.remove('is-active');
            textTab.classList.add('is-active');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    harmonizeHeaderNavigation();
    const observer = new MutationObserver(() => {
        harmonizeHeaderNavigation();
    });
    observer.observe(document.body, { childList: true, subtree: true });
});
