const Http = require('http');
const WebSocket = require('ws');
const app = require('./app');

const PORT = 8020;
const httpServer = Http.createServer(app);

// Inicializa o servidor WebSocket acoplado ao servidor HTTP do Express
const wss = new WebSocket.Server({ server: httpServer });

// Mapa para rastrear conexões ativas por pilot_uid: Map<number, Set<WebSocket>>
const connectedClients = new Map();

wss.on('connection', (ws, req) => {
    console.log('Novo cliente conectado via WebSocket.');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // Quando o cliente se identifica e registra seu pilot_uid
            if (data.type === 'REGISTER') {
                const pilotUid = Number(data.pilot_uid);
                if (!isNaN(pilotUid) && pilotUid > 0) {
                    ws.pilotUid = pilotUid;

                    if (!connectedClients.has(pilotUid)) {
                        connectedClients.set(pilotUid, new Set());
                    }
                    connectedClients.get(pilotUid).add(ws);

                    ws.send(JSON.stringify({ type: 'REGISTERED', status: 'OK' }));
                    console.log(`Piloto ${pilotUid} registrado com sucesso no WebSocket.`);
                }
            }
        } catch (err) {
            console.error('Erro ao processar mensagem do WebSocket:', err);
        }
    });

    ws.on('close', () => {
        if (ws.pilotUid && connectedClients.has(ws.pilotUid)) {
            const userSockets = connectedClients.get(ws.pilotUid);
            userSockets.delete(ws);
            if (userSockets.size === 0) {
                connectedClients.delete(ws.pilotUid);
            }
            console.log(`Piloto ${ws.pilotUid} desconectado do WebSocket.`);
        } else {
            console.log('Cliente não registrado desconectado.');
        }
    });
});

// Função auxiliar exportável ou utilizável para disparar avisos em tempo real
function notifyPilots(pilotUids, payload) {
    const targets = Array.isArray(pilotUids) ? pilotUids : [pilotUids];
    targets.forEach((pilotUid) => {
        const userSockets = connectedClients.get(Number(pilotUid));
        if (userSockets) {
            userSockets.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(payload));
                }
            });
        }
    });
}

// Tornando o notifyPilots acessível globalmente ou exportando se necessário
app.locals.notifyPilots = notifyPilots;

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor Star Orphans rodando na porta ${PORT} (0.0.0.0) com suporte a WebSockets`);
});
// restart nodemon 639282035211640099