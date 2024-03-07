const path = require('path');
const fs = require('fs');

class WPPGlobal {
    async enableInterceptWPP(page) {
        await page.setRequestInterception(true);
        await page.on('request', (req) => {
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
    
    /**
     * Проверка что WPP доступен
     */
    checkWPP() {
        
    }
    
    /**
     * Обработка и подписка на события 
     */
    handleEvents() {
        
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

module.exports = WPPGlobal;