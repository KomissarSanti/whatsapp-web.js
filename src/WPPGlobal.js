const path = require('path');
const fs = require('fs');
const {WhatsWebURL, Events} = require('./util/Constants');

class WPPGlobal {
    constructor() {
        this.pupPage = null;
    }

    async bindPage(page) {
        this.pupPage = page;
    }

    async enableInterceptWPP() {
        await this.pupPage.setRequestInterception(true);
        await this.pupPage.on('request', (req) => {
            const filePathDist = require.resolve('@wppconnect/wa-js');

            if (req.url().includes('dist') && fs.existsSync(filePathDist)) {
                req.respond({
                    status: 201,
                    contentType: 'text/javascript; charset=UTF-8',
                    body: fs.readFileSync(filePathDist, { encoding: 'utf8' }),
                });
            } else {
                req.continue();
            }
        });
    }

    async addWPPScriptTag() {
        await this.pupPage.addScriptTag({
            url: `${WhatsWebURL}dist/wppconnect-wa.js`,
        });

        return true;
    }

    /**
     * Обработка и подписка на события
     */
    async handleEvents(callback) {
        await this.pupPage.exposeFunction('handleEventsMethod', callback);

        console.log('handleEvents method');
        
        await this.pupPage.evaluate(async (Events) => {
            const isReady = await window.WPP.conn.isMainReady();
            
            if (isReady) {
                window.handleEventsMethod(Events.READY, null);
            }
            else {
                const qr = await window.window.conn.getAuthCode();
                window.handleEventsMethod(Events.QR_RECEIVED, qr.fullCode);
            }

            window.WPP.ev.on('conn.auth_code_change', (msg) => {
                window.handleEventsMethod(Events.QR_RECEIVED, msg.fullCode);
            });
            window.WPP.ev.on('conn.main_loaded', (msg) => {
                window.handleEventsMethod(Events.AUTHENTICATED, msg);
            });
            window.WPP.ev.on('conn.main_ready', (msg) => {
                window.handleEventsMethod(Events.READY, msg);
            });
            window.WPP.ev.on('conn.logout', (msg) => {
                window.handleEventsMethod(Events.DISCONNECTED, msg);
            });
        }, Events);
    }

    /**
     * QR Code Handler
     *
     * @return {Promise<boolean>}
     */
    async handleQrCode() {

    }

    /**
     * Обработка телефонного кода
     *
     * @return {Promise<void>}
     */
    async handlePhoneCode() {

    }

    /**
     *
     * @return {Promise<void>}
     */
    async handleSendMessage() {

    }
}

module.exports = new WPPGlobal;