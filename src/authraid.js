/*
* moduleRaid v6
 * https://github.com/wwebjs/moduleRaid
 *
 * Copyright pixeldesu, pedroslopez, purpshell and other contributors
 * Licensed under the MIT License
 * https://github.com/wwebjs/moduleRaid/blob/master/LICENSE
 */

const authRaid = function () {
    authRaid.mObj = {};

    let modules = self.require('__debug').modulesMap;
    
    fillModuleArray = function() {
        let deviceActionId = 'WAWebLinkDeviceAction';
        let linkingApiId = 'WAWebAltDeviceLinkingApi';
        
        Object.keys(modules).filter(e => (e.includes(deviceActionId) || e.includes(linkingApiId))).forEach(function (mod) {
            let modulos = modules[mod];
            if (modulos) {
                authRaid.mObj[mod] = {
                    default: modulos.defaultExport,
                    factory: modulos.factory,
                    ...modulos
                };
                if (Object.keys(authRaid.mObj[mod].default).length == 0) {
                    try {
                        self.ErrorGuard.skipGuardGlobal(true);
                        Object.assign(authRaid.mObj[mod], self.importNamespace(mod));
                    } catch (e) {
                    }
                }
            }
        })
    }

    get = function get (id) {
        return authRaid.mObj[id]
    }

    findModule = function findModule (query) {
        results = [];
        modules = Object.keys(authRaid.mObj);

        modules.forEach(function(mKey) {
            mod = authRaid.mObj[mKey];

            if (typeof mod !== 'undefined') {
                if (typeof query === 'string') {
                    if (typeof mod.default === 'object') {
                        for (key in mod.default) {
                            if (key == query) results.push(mod);
                        }
                    }

                    for (key in mod) {
                        if (key == query) results.push(mod);
                    }
                } else if (typeof query === 'function') {
                    if (query(mod)) {
                        results.push(mod);
                    }
                } else {
                    throw new TypeError('findModule can only find via string and function, ' + (typeof query) + ' was passed');
                }
            }
        })

        return results;
    }

    return {
        modules: authRaid.mObj,
        constructors: authRaid.cArr,
        findModule: findModule,
        get: get
    }
}

module.exports = authRaid;