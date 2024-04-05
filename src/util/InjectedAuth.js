'use strict';

// Exposes the internal Store to the WhatsApp Web client
exports.ExposeStoreAuth = (moduleRaidStr) => {
    eval('var moduleRaid = ' + moduleRaidStr);
    // eslint-disable-next-line no-undef
    window.mR2 = moduleRaid();
    // window.Store.AuthGetPhoneCode = (m = window.mR2.findModule('genLinkDeviceCodeForPhoneNumber')).length > 0 && m[0];
    window.StoreAuth = Object.assign({}, );
    window.StoreAuth.InitPhoneCode = window.mR2.findModule('initializeAltDeviceLinking')[0];
    window.StoreAuth.AuthGetPhoneCode = window.mR2.findModule('genLinkDeviceCodeForPhoneNumber')[0];

    /* eslint-enable no-undef, no-cond-assign */

    // window.Store.Settings = {
    //     ...window.mR.findModule('ChatlistPanelState')[0],
    //     setPushname: window.mR.findModule((m) => m.setPushname && !m.ChatlistPanelState)[0].setPushname
    // };

    /**
     * Target options object description
     * @typedef {Object} TargetOptions
     * @property {string|number} module The name or a key of the target module to search
     * @property {number} index The index value of the target module
     * @property {string} function The function name to get from a module
     */

    /**
     * Function to modify functions
     * @param {TargetOptions} target Options specifying the target function to search for modifying
     * @param {Function} callback Modified function
     */
    // window.injectToFunction = (target, callback) => {
    //     const module = typeof target.module === 'string'
    //         ? window.mR.findModule(target.module)
    //         : window.mR.modules[target.module];
    //     const originalFunction = module[target.index][target.function];
    //     const modifiedFunction = (...args) => callback(originalFunction, ...args);
    //     module[target.index][target.function] = modifiedFunction;
    // };
    //
    // window.injectToFunction({ module: 'mediaTypeFromProtobuf', index: 0, function: 'mediaTypeFromProtobuf' }, (func, ...args) => { const [proto] = args; return proto.locationMessage ? null : func(...args); });
    //
    // window.injectToFunction({ module: 'typeAttributeFromProtobuf', index: 0, function: 'typeAttributeFromProtobuf' }, (func, ...args) => { const [proto] = args; return proto.locationMessage || proto.groupInviteMessage ? 'text' : func(...args); });
};

exports.LoadUtilsAuth = () => {
    window.WWebJSAuth = {};

    window.WWebJSAuth.qrInit = async () => {
        await window.StoreAuth.InitPhoneCode.initializeQRLinking();
    }

    window.WWebJSAuth.getPhoneCode = async (phone, init) => {
        // let chat = window.Store.Chat.get(phone);
        // if (chat !== undefined) {
        //     await window.Store.Auth.getPhoneCode(phone, false);
        //     return true;
        // }
        // return false;
        if (init) {
            await window.StoreAuth.InitPhoneCode.initializeAltDeviceLinking();
        }
        
        const result = await window.StoreAuth.AuthGetPhoneCode.genLinkDeviceCodeForPhoneNumber(phone, true);

        return result;
    };
};