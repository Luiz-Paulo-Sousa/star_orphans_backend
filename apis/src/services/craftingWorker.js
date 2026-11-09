const db = require('../config/database');

let isWorkerRunning = false;
let workerTimer = null;

/**
 * Adiciona o item ao contêiner no hangar do jogador
 * (Mesma lógica segura utilizada pelo hangarController)
 */
async function addItemToContainer(conn, containerUid, itemCode, qtyToAdd) {
    const existing = await conn.query(
        "SELECT slot, amount FROM container_slots WHERE container_uid = ? AND item_code = ? ORDER BY slot ASC LIMIT 1 FOR UPDATE",
        [containerUid, itemCode]
    );

    if (existing.length > 0) {
        await conn.query(
            "UPDATE container_slots SET amount = amount + ? WHERE container_uid = ? AND slot = ?",
            [qtyToAdd, containerUid, existing[0].slot]
        );
    } else {
        const maxRow = await conn.query(
            "SELECT COALESCE(MAX(slot), 0) AS max_slot FROM container_slots WHERE container_uid = ?",
            [containerUid]
        );
        const nextSlot = Number(maxRow[0].max_slot || 0) + 1;
        await conn.query(
            "INSERT INTO container_slots (container_uid, slot, item_code, amount) VALUES (?, ?, ?, ?)",
            [containerUid, nextSlot, itemCode, qtyToAdd]
        );
    }

    // Recalcula o volume ocupado do contêiner
    try {
        const volRows = await conn.query(
            `SELECT COALESCE(SUM(cs.amount * GREATEST(1, COALESCE(i.volume, 1))), 0) AS used_vol
             FROM container_slots cs
             INNER JOIN items i ON i.item_code = cs.item_code
             WHERE cs.container_uid = ? AND cs.amount > 0`,
            [containerUid]
        );
        const usedVol = volRows.length > 0 ? Number(volRows[0].used_vol) : 0;
        await conn.query(
            "UPDATE containers SET current_volume = ? WHERE container_uid = ?",
            [usedVol, containerUid]
        );
    } catch (volErr) {
        console.warn(`[CraftWorker] Aviso ao atualizar volume do container ${containerUid}:`, volErr.message);
    }
}

/**
 * Ciclo de verificação e entrega dos itens da fila de fabricação
 */
async function processCraftingQueue(notifyPilotsFn) {
    let conn;
    try {
        conn = await db.getConnection();

        // 1. Busca até 50 itens prontos que ainda estejam 'in_progress'
        const readyOrders = await conn.query(
            `SELECT 
                cq.queue_uid,
                cq.pilot_uid,
                cq.container_uid,
                cq.item_code,
                cq.amount,
                cq.orbit,
                cq.station,
                cq.delivery_date,
                COALESCE(i.name, CONCAT('Item #', cq.item_code)) AS item_name,
                COALESCE(st.name, CONCAT('Estação #', cq.station)) AS station_name
             FROM craft_queues cq
             LEFT JOIN items i ON i.item_code = cq.item_code
             LEFT JOIN orbit_stations st ON st.id = cq.station
             WHERE cq.status = 'in_progress' 
               AND cq.delivery_date <= NOW()
             ORDER BY cq.delivery_date ASC
             LIMIT 50`
        );

        const ordersList = Array.isArray(readyOrders) && Array.isArray(readyOrders[0]) ? readyOrders[0] : readyOrders;

        if (ordersList.length === 0) {
            return;
        }

        console.log(`[CraftWorker] Processando ${ordersList.length} ordens de fabricação prontas...`);

        // 2. Processa cada ordem concluída
        for (const order of ordersList) {
            const queueUid = Number(order.queue_uid);
            const pilotUid = Number(order.pilot_uid);
            const containerUid = Number(order.container_uid);
            const itemCode = Number(order.item_code);
            const amount = Number(order.amount) || 1;
            const stationId = Number(order.station);
            const stationAccountUid = 900000 + stationId; // Conta da estação no chat
            const itemName = order.item_name;
            const stationName = order.station_name;

            try {
                await conn.beginTransaction();

                // Marca como 'completed' atomicamente
                const updateRes = await conn.query(
                    "UPDATE craft_queues SET status = 'completed' WHERE queue_uid = ? AND status = 'in_progress'",
                    [queueUid]
                );

                if (updateRes.affectedRows === 0) {
                    await conn.rollback();
                    continue; // Outra thread ou ciclo já processou
                }

                // Entrega os itens no estoque do hangar
                await addItemToContainer(conn, containerUid, itemCode, amount);

                // Prepara a mensagem de chat
                const chatText = `Sua ordem de fabricação de ${amount}x [${itemName}] foi concluída com sucesso! Os itens já estão disponíveis no seu hangar na ${stationName}.`;

                // 1. Mensagem para o Jogador (na conversa dele com a estação)
                await conn.query(
                    `INSERT INTO messages (type, date_time, uid_destination, uid_origin, text, uid_channel, uid_subchannel, status, is_read)
                     VALUES (0, NOW(), ?, ?, ?, 6, ?, 2, 0)`,
                    [pilotUid, stationAccountUid, chatText, stationAccountUid]
                );

                // 2. Réplica na estação (histórico da conversa)
                await conn.query(
                    `INSERT INTO messages (type, date_time, uid_destination, uid_origin, text, uid_channel, uid_subchannel, status, is_read)
                     VALUES (0, NOW(), ?, ?, ?, 6, ?, 2, 1)`,
                    [stationAccountUid, stationAccountUid, chatText, pilotUid]
                );

                await conn.commit();
                console.log(`[CraftWorker] Ordem #${queueUid} concluída: ${amount}x ${itemName} entregue ao piloto ${pilotUid}.`);

                // 3. Notificação WebSocket instantânea no Flutter
                if (typeof notifyPilotsFn === 'function') {
                    notifyPilotsFn([pilotUid], {
                        type: 'CHAT_NOTIFICATION',
                        data: {
                            channel_uid: 6,
                            subchannel_uid: stationAccountUid,
                            sender_uid: stationAccountUid,
                            message_text: chatText,
                            timestamp: new Date().toISOString()
                        }
                    });
                }
            } catch (orderErr) {
                await conn.rollback();
                console.error(`[CraftWorker] Erro ao processar ordem #${queueUid}:`, orderErr);
            }
        }
    } catch (err) {
        console.error('[CraftWorker] Erro durante o ciclo de verificação:', err);
    } finally {
        if (conn) conn.release();
    }
}

/**
 * Inicia o Worker em segundo plano
 * @param {Function} notifyPilotsFn Função do WebSocket para alertar jogadores
 * @param {number} intervalMs Intervalo de checagem em milissegundos (padrão: 3 segundos)
 */
function startCraftingWorker(notifyPilotsFn, intervalMs = 3000) {
    if (isWorkerRunning) {
        console.log('[CraftWorker] Worker já está em execução.');
        return;
    }

    isWorkerRunning = true;
    console.log(`[CraftWorker] Iniciado com intervalo de ${intervalMs}ms.`);

    const tick = async () => {
        if (!isWorkerRunning) return;
        try {
            await processCraftingQueue(notifyPilotsFn);
        } catch (e) {
            console.error('[CraftWorker] Falha não tratada no tick:', e);
        } finally {
            if (isWorkerRunning) {
                workerTimer = setTimeout(tick, intervalMs);
            }
        }
    };

    workerTimer = setTimeout(tick, 1000);
}

/**
 * Para o Worker de forma limpa
 */
function stopCraftingWorker() {
    isWorkerRunning = false;
    if (workerTimer) {
        clearTimeout(workerTimer);
        workerTimer = null;
    }
    console.log('[CraftWorker] Worker finalizado.');
}

module.exports = {
    startCraftingWorker,
    stopCraftingWorker,
    processCraftingQueue
};
