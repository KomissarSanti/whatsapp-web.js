'use strict';

const EventEmitter = require('events');
const puppeteer = require('puppeteer');
const fs = require('fs');

const Util = require('./util/Util');
const { WhatsWebURL, DefaultOptions, Events, WAState } = require('./util/Constants');
const WebCacheFactory = require('./webCache/WebCacheFactory');
const WPPGlobal = require('./WPPGlobal');

/**
 * Starting point for interacting with the WhatsApp Web API
 * @extends {EventEmitter}
 * @param {object} options - Client options
 * @param {AuthStrategy} options.authStrategy - Determines how to save and restore sessions. Will use LegacySessionAuth if options.session is set. Otherwise, NoAuth will be used.
 * @param {string} options.webVersion - The version of WhatsApp Web to use. Use options.webVersionCache to configure how the version is retrieved.
 * @param {object} options.webVersionCache - Determines how to retrieve the WhatsApp Web version. Defaults to a local cache (LocalWebCache) that falls back to latest if the requested version is not found.
 * @param {number} options.authTimeoutMs - Timeout for authentication selector in puppeteer
 * @param {object} options.puppeteer - Puppeteer launch options. View docs here: https://github.com/puppeteer/puppeteer/
 * @param {number} options.qrMaxRetries - @deprecated This option should be set directly on the `linkingMethod.qr`.
 * @param {string} options.restartOnAuthFail  - @deprecated This option should be set directly on the LegacySessionAuth.
 * @param {object} options.session - @deprecated Only here for backwards-compatibility. You should move to using LocalAuth, or set the authStrategy to LegacySessionAuth explicitly.
 * @param {number} options.takeoverOnConflict - If another whatsapp web session is detected (another browser), take over the session in the current browser
 * @param {number} options.takeoverTimeoutMs - How much time to wait before taking over the session
 * @param {string} options.userAgent - User agent to use in puppeteer
 * @param {string} options.ffmpegPath - Ffmpeg path to use when formating videos to webp while sending stickers
 * @param {boolean} options.bypassCSP - Sets bypassing of page's Content-Security-Policy.
 * @param {object} options.proxyAuthentication - Proxy Authentication object.
 * @param {object} options.linkingMethod - Method to link with Whatsapp account. Can be either through QR code or phone number. Defaults to QR code.
 *
 * @fires Client#auth_mode
 * @fires Client#qr
 * @fires Client#code
 * @fires Client#authenticated
 * @fires Client#auth_failure
 * @fires Client#ready
 * @fires Client#message
 * @fires Client#message_ack
 * @fires Client#message_create
 * @fires Client#message_revoke_me
 * @fires Client#message_revoke_everyone
 * @fires Client#media_uploaded
 * @fires Client#group_join
 * @fires Client#group_leave
 * @fires Client#group_update
 * @fires Client#disconnected
 * @fires Client#change_state
 * @fires Client#contact_changed
 * @fires Client#group_admin_changed
 */
class ClientWPP extends EventEmitter {
    constructor(options = {}) {
        super();

        this.options = Util.mergeDefault(DefaultOptions, options);

        this.authStrategy = this.options.authStrategy;

        this.authStrategy.setup(this);
        this.pupBrowser = null;
        this.pupPage = null;

        Util.setFfmpegPath(this.options.ffmpegPath);
    }

    /**
     * Sets up events and requirements, kicks off authentication request
     */
    async initialize() {
        try {
            let [browser, page] = [null, null];

            await this.authStrategy.beforeBrowserInitialized();

            const puppeteerOpts = this.options.puppeteer;
            if (puppeteerOpts && puppeteerOpts.browserWSEndpoint) {
                browser = await puppeteer.connect(puppeteerOpts);
                page = await browser.newPage();
            } else {
                const browserArgs = [...(puppeteerOpts.args || [])];
                if (!browserArgs.find(arg => arg.includes('--user-agent'))) {
                    browserArgs.push(`--user-agent=${this.options.userAgent}`);
                }

                browser = await puppeteer.launch({...puppeteerOpts, args: browserArgs});
                page = (await browser.pages())[0];
            }

            if (this.options.proxyAuthentication !== undefined) {
                await page.authenticate(this.options.proxyAuthentication);
            }

            await page.setUserAgent(this.options.userAgent);
            if (this.options.bypassCSP) await page.setBypassCSP(true);

            this.pupBrowser = browser;
            this.pupPage = page;

            await this.authStrategy.afterBrowserInitialized();
            // await this.initWebVersionCache();

            // -- intercept for wpp lib
            await WPPGlobal.bindPage(page);
            await WPPGlobal.enableInterceptWPP();
            // ----

            await page.goto(WhatsWebURL, {
                waitUntil: 'load',
                timeout: 0,
                referer: 'https://whatsapp.com/'
            }).then(async () => {
            });

            const expireDate = Math.floor(Date.now() / 1000) + (60 * 24 * 60 * 60);
            const cookies = [{
                'name': 'wa_build',
                'value': 'c',
                'domain': '.web.whatsapp.com',
                'expires': expireDate
            }];
            await page.setCookie(...cookies);

            await page.reload();

            await page.evaluate(`function getElementByXpath(path) {
            return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          }`);

            let lastPercent = null,
                lastPercentMessage = null;

            await page.exposeFunction('loadingScreen', async (percent, message) => {
                if (lastPercent !== percent || lastPercentMessage !== message) {
                    this.emit(Events.LOADING_SCREEN, percent, message);
                    lastPercent = percent;
                    lastPercentMessage = message;
                }
            });

            await page.evaluate(
                async function (selectors) {
                    var observer = new MutationObserver(function () {
                        let progressBar = window.getElementByXpath(
                            selectors.PROGRESS
                        );
                        let progressMessage = window.getElementByXpath(
                            selectors.PROGRESS_MESSAGE
                        );

                        if (progressBar) {
                            console.log('progressBar', progressBar.value);

                            window.loadingScreen(
                                progressBar.value,
                                progressMessage.innerText
                            );
                        }
                    });

                    observer.observe(document, {
                        attributes: true,
                        childList: true,
                        characterData: true,
                        subtree: true,
                    });
                },
                {
                    PROGRESS: '//*[@id=\'app\']/div/div/div[2]/progress',
                    PROGRESS_MESSAGE: '//*[@id=\'app\']/div/div/div[3]',
                }
            );

            const INTRO_IMG_SELECTOR = '[data-icon=\'search\']';
            const INTRO_QRCODE_SELECTOR = 'div[data-ref] canvas';
            // Checks which selector appears first
            const needAuthentication = await Promise.race([
                new Promise(resolve => {
                    page.waitForSelector(INTRO_IMG_SELECTOR, {timeout: this.options.authTimeoutMs})
                        .then(() => resolve(false))
                        .catch((err) => resolve(err));
                }),
                new Promise(resolve => {
                    page.waitForSelector(INTRO_QRCODE_SELECTOR, {timeout: this.options.authTimeoutMs})
                        .then(() => resolve(true))
                        .catch((err) => resolve(err));
                })
            ]);

            // Checks if an error occurred on the first found selector. The second will be discarded and ignored by .race;
            if (needAuthentication instanceof Error) throw needAuthentication;

            await page.evaluate(() => {
                window.globalThis.ErrorGuard.skipGuardGlobal(true);
            });

            // Scan-qrcode selector was found. Needs authentication
            if (needAuthentication) {
                console.log('is not auth');

                // const file = fs.readFileSync('@wppconnect/wa-js/wppconnect-wa.js');

                console.log(require.resolve('@wppconnect/wa-js'));
                // eval()

                // await page.addScriptTag({
                //     path: require.resolve('@wppconnect/wa-js'),
                // });
            }
            else {
                console.log('is auth');
                // await page.addScriptTag({
                //     path: require.resolve('@wppconnect/wa-js'),
                // });
            }

            // Check window.WPP Injection
            await page.waitForFunction(() => window.WPP?.isReady);

            await WPPGlobal.handleEvents(async (event, data) => {
                console.log('emit', event, data);
                this.emit(event, data);
            });
            // ----

            await page.evaluate(async () => {
                // safely unregister service workers
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (let registration of registrations) {
                    registration.unregister();
                }
            });

            return true;
        }
        catch (error) {
            return {error};
        }
    } // -- end initialize

    handleQrCode() {
        return this.pupPage.evaluate(async () => {
            const code = await window.WPP.conn.getAuthCode();

            console.log(code);

            return code;
        });
    }

    async initWebVersionCache() {
        const { type: webCacheType, ...webCacheOptions } = this.options.webVersionCache;
        const webCache = WebCacheFactory.createWebCache(webCacheType, webCacheOptions);

        const requestedVersion = this.options.webVersion;
        const versionContent = await webCache.resolve(requestedVersion);

        if(versionContent) {
            await this.pupPage.setRequestInterception(true);
            this.pupPage.on('request', async (req) => {
                if(req.url() === WhatsWebURL) {
                    req.respond({
                        status: 200,
                        contentType: 'text/html',
                        body: versionContent
                    });
                } else {
                    req.continue();
                }
            });
        } else {
            this.pupPage.on('response', async (res) => {
                if(res.ok() && res.url() === WhatsWebURL) {
                    await webCache.persist(await res.text());
                }
            });
        }
    }
}

module.exports = ClientWPP;
