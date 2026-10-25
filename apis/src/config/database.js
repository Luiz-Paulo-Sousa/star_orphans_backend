const mariadb = require('mariadb');

const pool = mariadb.createPool({
     host: 'MariaDB', 
     user: process.env.MARIADB_USER || 'root', 
     password: process.env.MARIADB_PASSWORD || 'root178592',
     database: '_starorphans',
     connectionLimit: 5
});

module.exports = pool;