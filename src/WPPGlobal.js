const path = require('path');
const fs = require('fs');
const {WhatsWebURL} = require('./util/Constants');

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
            const fileName = path.basename(req.url());
            const filePathDist = path.join(
                path.resolve(__dirname, '../dist/'),
                fileName
            );

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
    }
    
    /**
     * Обработка и подписка на события 
     */
    async handleEvents(callback) {
        await this.pupPage.evaluate(async () => {

            window.WPP.ev.on('conn.auth_code_change', (msg) => {
                // window.onChangeMessageEvent(window.WWebJS.getMessageModel(msg));

                console.log('qr', msg);
            });
        });
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