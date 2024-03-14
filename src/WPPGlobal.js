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
                const qr = await window.WPP.conn.getAuthCode();

                if (qr) {
                    window.handleEventsMethod(Events.QR_RECEIVED, qr.fullCode);
                }
            }

            // -- AUTH
            window.WPP.ev.on('conn.auth_code_change', (msg) => {
                if (msg) {
                    window.handleEventsMethod(Events.QR_RECEIVED, msg.fullCode);
                }
            });
            window.WPP.ev.on('conn.main_loaded', (msg) => {
                // window.handleEventsMethod(Events.AUTHENTICATED, msg);
            });
            window.WPP.ev.on('conn.main_ready', (msg) => {
                window.handleEventsMethod(Events.READY, msg);
            });
            window.WPP.ev.on('conn.logout', (msg) => {
                window.handleEventsMethod(Events.DISCONNECTED, msg);
            });
            // -- -- --

            // -- CHAT
            window.WPP.ev.on('chat.new_message', (msg) => {
                window.handleEventsMethod('message_new', msg);
            });
            window.WPP.ev.on('chat.msg_ack_change', (acks) => {
                console.log(acks);
                acks.ids.forEach(async (ack) => {
                    console.log('device', ack.remote.device, acks.ack);
                    // const messageId = ack.fromMe.toString() + '_' + ack.remote.user + '@c.us' + '_' + ack.id;
                    if(ack.remote.device === undefined) {
                        const message = await window.WPP.chat.getMessageById(ack._serialized);
                        if (message) {
                            window.handleEventsMethod('message_ack_new', {message, ack: acks.ack});
                        }
                    }
                });

            });
            // -- -- --

        }, Events);
    }
}

module.exports = new WPPGlobal;