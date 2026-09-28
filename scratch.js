const { Cashfree } = require('cashfree-pg');
console.log('Static:', Object.getOwnPropertyNames(Cashfree));
console.log('Prototype:', Object.getOwnPropertyNames(Cashfree.prototype));
for(const key of Object.getOwnPropertyNames(Cashfree)) {
    console.log(key, typeof Cashfree[key]);
}
