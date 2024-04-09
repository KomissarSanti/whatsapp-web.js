'use strict';

const EventEmitter = require('events');
const puppeteer = require('puppeteer');
// const moduleRaid = require('@pedroslopez/moduleraid/moduleraid');
const moduleRaid = require('moduleraid/moduleraid');

const Util = require('./util/Util');
const InterfaceController = require('./util/InterfaceController');
const { WhatsWebURL, DefaultOptions, Events, WAState } = require('./util/Constants');
const { ExposeStore, LoadUtils } = require('./util/Injected');
const { ExposeStoreAuth, LoadUtilsAuth } = require('./util/InjectedAuth');
const ChatFactory = require('./factories/ChatFactory');
const ContactFactory = require('./factories/ContactFactory');
const WebCacheFactory = require('./webCache/WebCacheFactory');
const { ClientInfo, Message, MessageMedia, Contact, Location, Poll, GroupNotification, Label, Call, Buttons, List, Reaction } = require('./structures');
const LegacySessionAuth = require('./authStrategies/LegacySessionAuth');
const NoAuth = require('./authStrategies/NoAuth');
const LinkingMethod = require('./LinkingMethod');
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
class Client extends EventEmitter {
    constructor(options = {}) {
        super();

        this.options = Util.mergeDefault(DefaultOptions, options);

        if (!this.options.linkingMethod) {
            this.options.linkingMethod = new LinkingMethod({
                qr: {
                    maxRetries: this.options.qrMaxRetries,
                },
            });
        }

        if(!this.options.authStrategy) {
            if(Object.prototype.hasOwnProperty.call(this.options, 'session')) {
                process.emitWarning(
                    'options.session is deprecated and will be removed in a future release due to incompatibility with multi-device. ' +
                    'Use the LocalAuth authStrategy, don\'t pass in a session as an option, or suppress this warning by using the LegacySessionAuth strategy explicitly (see https://wwebjs.dev/guide/authentication.html#legacysessionauth-strategy).',
                    'DeprecationWarning'
                );

                this.authStrategy = new LegacySessionAuth({
                    session: this.options.session,
                    restartOnAuthFail: this.options.restartOnAuthFail
                });
            } else {
                this.authStrategy = new NoAuth();
            }
        } else {
            this.authStrategy = this.options.authStrategy;
        }

        this.authStrategy.setup(this);
        this.pupBrowser = null;
        this.pupPage = null;

        Util.setFfmpegPath(this.options.ffmpegPath);
    }

    async initializeWpp() {
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

            // navigator.webdriver fix
            browserArgs.push('--disable-blink-features=AutomationControlled');

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

        // -- intercept for wpp lib
        await WPPGlobal.bindPage(page);
        await WPPGlobal.enableInterceptWPP();
        // ----

        await page.goto(WhatsWebURL, {
            waitUntil: 'load',
            timeout: 0,
            referer: 'https://whatsapp.com/'
        }).then(async () => {
            await WPPGlobal.addWPPScriptTag();
        });

        // Check window.WPP Injection
        await page.waitForFunction(() => window.WPP?.isReady);

        await page.exposeFunction('ConnEvent', (msg) => {
            this.emit(msg.event, msg.data);
        });

        await page.evaluate(() => {
            window.WPP.ev.on('conn.auth_code_change', (msg) => {
                let eventName = 'conn.auth_code_change';

                console.log(eventName, msg);
                window.ConnEvent({event: eventName, data: msg});
            });
            window.WPP.ev.on('conn.authenticated', (msg) => {
                let eventName = 'conn.authenticated';

                console.log(eventName, msg);
                window.ConnEvent({event: eventName, data: msg});
            });
            window.WPP.ev.on('conn.main_init', (msg) => {
                let eventName = 'conn.main_init';

                console.log(eventName, msg);
                window.ConnEvent({event: eventName, data: msg});
            });
            window.WPP.ev.on('conn.main_loaded', (msg) => {
                let eventName = 'conn.main_loaded';

                console.log(eventName, msg);
                window.ConnEvent({event: eventName, data: msg});
            });
            window.WPP.ev.on('conn.main_ready', (msg) => {
                let eventName = 'conn.main_ready';

                console.log(eventName, msg);
                window.ConnEvent({event: eventName, data: msg});
            });
            window.WPP.ev.on('conn.require_auth', (msg) => {
                let eventName = 'conn.require_auth';

                console.log(eventName, msg);
                window.ConnEvent({event: eventName, data: msg});
            });
            window.WPP.on('chat.new_message', (msg) => {
                let eventName = 'chat.new_message';

                window.ConnEvent({event: eventName, data: msg});
            });
        });
    }

    async handlePhoneCode(phone) {
        const innerThis = this;

        /**
         * Emitted when a QR code is received
         * @event Client#auth_mode
         * @param {string} mode auth mode
         */
        this.emit(Events.AUTH_MODE, 'phoneCode');

        if (!await this.pupPage.evaluate(() => {return window.codeChanged;})) {
            await this.pupPage.exposeFunction('codeChanged', async (code) => {
                /**
                 * Emitted when a Phone code is received
                 * @event Client#code
                 * @param {string} code Code
                 */
                innerThis.emit(Events.CODE_RECEIVED, code);
            });
        }

        let result = await this.pupPage.evaluate(async (phone) => {
            const code = await window.WWebJSAuth.getPhoneCode(phone, true);

            window.codeChanged(code);

            return code;
        }, phone);

        return result;
    }

    /**
     * Closes the client
     */
    async destroy() {
        await this.pupBrowser.close();
        await this.authStrategy.destroy();
    }

    /**
     * Logs out the client, closing the current session
     */
    async logout() {
        await this.pupPage.evaluate(() => {
            return window.Store.AppState.logout();
        });
        await this.pupBrowser.close();

        let maxDelay = 0;
        while (this.pupBrowser.isConnected() && (maxDelay < 10)) { // waits a maximum of 1 second before calling the AuthStrategy
            await new Promise(resolve => setTimeout(resolve, 100));
            maxDelay++;
        }

        await this.authStrategy.logout();
    }

    /**
     * Returns the version of WhatsApp Web currently being run
     * @returns {Promise<string>}
     */
    async getWWebVersion() {
        return await this.pupPage.evaluate(() => {
            return window.Debug.VERSION;
        });
    }

    /**
     * Mark as seen for the Chat
     *  @param {string} chatId
     *  @returns {Promise<boolean>} result
     *
     */
    async sendSeen(chatId) {
        const result = await this.pupPage.evaluate(async (chatId) => {
            return window.WPP.chat.markIsRead(chatId);

        }, chatId);
        
        return result;
    }
    
    /**
     * Get contact instance by ID
     * @param {string} contactId
     * @returns {Promise<Contact>}
     */
    async getContactById(contactId) {
        let contact = await this.pupPage.evaluate(contactId => {
            return window.WPP.contact.get(contactId);
        }, contactId);

        return ContactFactory.create(this, contact);
    }

    /**
     * Returns the contact ID's profile picture URL, if privacy settings allow it
     * @param {string} contactId the whatsapp user's ID
     * @returns {Promise<string>}
     */
    async getProfilePicUrl(contactId) {
        const profilePic = await this.pupPage.evaluate(async contactId => {
            try {
                return await window.WPP.contact.getProfilePuctureUrl(contactId);
            } catch (err) {
                if(err.name === 'ServerStatusCodeError') return undefined;
                throw err;
            }
        }, contactId);

        return profilePic ? profilePic : undefined;
    }
}

module.exports = Client;
