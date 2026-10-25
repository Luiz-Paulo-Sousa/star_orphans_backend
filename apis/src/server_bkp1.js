const Http = require('http');
const app = require('./app');

const PORT = 8020;
const httpServer = Http.createServer(app);

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor Star Orphans rodando na porta ${PORT} (0.0.0.0)`);
});
// restart nodemon 639282035211640012
