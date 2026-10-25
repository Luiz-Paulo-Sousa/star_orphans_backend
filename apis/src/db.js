const mariadb = require('mariadb');

const pool = mariadb.createPool({
     host: '127.0.0.1', 
     user: 'root', 
     password: 'root178592',
     database: '_starorphans',
     connectionLimit: 5
});

module.exports = pool;