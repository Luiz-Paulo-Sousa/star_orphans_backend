const recoveryCodes = new Map();

module.exports = {
    set: (key, data) => recoveryCodes.set(key, data),
    get: (key) => recoveryCodes.get(key),
    delete: (key) => recoveryCodes.delete(key),
};