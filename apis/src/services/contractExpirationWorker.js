const db = require('../config/database');

let isWorkerRunning = false;
let workerTimer = null;

/**
 * Verifica contratos aceitos cujo prazo (deadline_at) expirou sem conclusão
 * e os marca automaticamente como 'failed' tanto em contract_acceptances quanto em contracts.
 */
async function processExpiredContracts(notifyPilotsFn) {
    let conn;
    try {
        conn = await db.getConnection();

        const expiredRows = await conn.query(
            `SELECT 
                ca.acceptance_id,
                ca.contract_uid,
                ca.pilot_uid AS contractor_pilot_uid,
                ca.deadline_at,
                c.isuser_type,
                c.isuser_uid,
                c.title,
                c.reward_credits,
                c.collateral_credits,
                c.status AS contract_status
             FROM contract_acceptances ca
             INNER JOIN contracts c ON c.contract_uid = ca.contract_uid
             WHERE ca.status = 'active'
               AND ca.deadline_at IS NOT NULL
               AND ca.deadline_at <= NOW()
             ORDER BY ca.deadline_at ASC
             LIMIT 50`
        );

        const expiredList = Array.isArray(expiredRows) && Array.isArray(expiredRows[0])
            ? expiredRows[0]
            : expiredRows;

        if (!expiredList || expiredList.length === 0) {
            return;
        }

        console.log(`[ContractExpirationWorker] Processando ${expiredList.length} contrato(s) expirado(s)...`);

        for (const item of expiredList) {
            const acceptanceId = Number(item.acceptance_id);
            const contractUid = Number(item.contract_uid);
            const contractorUid = Number(item.contractor_pilot_uid);
            const issuerType = (item.isuser_type || 'system').toString().toLowerCase();
            const issuerUid = Number(item.isuser_uid || 0);
            const rewardCredits = Math.max(0, Number(item.reward_credits || 0));
            const collateralCredits = Math.max(0, Number(item.collateral_credits || 0));

            try {
                await conn.beginTransaction();

                // 1. Marca a aceitação ativa como 'failed' atomicamente
                const accUpdate = await conn.query(
                    "UPDATE contract_acceptances SET status = 'failed' WHERE acceptance_id = ? AND status = 'active'",
                    [acceptanceId]
                );

                if (!accUpdate || accUpdate.affectedRows === 0) {
                    await conn.rollback();
                    continue;
                }

                // 2. Marca o contrato como 'failed' (se ainda estiver em progresso)
                await conn.query(
                    "UPDATE contracts SET status = 'failed' WHERE contract_uid = ? AND status = 'in_progress'",
                    [contractUid]
                );

                // 3. Estorna recompensa retida (+ eventual caução perdida pelo contratado) ao contratante piloto
                //    Isso garante que, se o contratante optar por Reativar o contrato depois, não haja cobrança dupla.
                const refundToIssuer = rewardCredits + collateralCredits;
                if (issuerType === 'pilot' && issuerUid > 0 && refundToIssuer > 0) {
                    await conn.query(
                        "UPDATE wallets SET credits = credits + ? WHERE wallet_uid = ?",
                        [refundToIssuer, issuerUid]
                    );
                }

                await conn.commit();
                console.log(
                    `[ContractExpirationWorker] Contrato #${contractUid} ("${item.title}") marcado como FAILED (aceitação #${acceptanceId}, piloto contratado ${contractorUid}).`
                );

                // 4. Notifica os envolvidos via WebSocket, se conectados
                if (typeof notifyPilotsFn === 'function') {
                    const targets = [contractorUid];
                    if (issuerType === 'pilot' && issuerUid > 0 && issuerUid !== contractorUid) {
                        targets.push(issuerUid);
                    }
                    notifyPilotsFn(targets, {
                        type: 'CONTRACT_EXPIRED',
                        data: {
                            contract_uid: contractUid,
                            acceptance_id: acceptanceId,
                            title: item.title,
                            status: 'failed',
                            timestamp: new Date().toISOString()
                        }
                    });
                }
            } catch (itemErr) {
                await conn.rollback();
                console.error(`[ContractExpirationWorker] Erro ao expirar contrato #${contractUid}:`, itemErr);
            }
        }
    } catch (err) {
        console.error('[ContractExpirationWorker] Erro durante o ciclo de verificação:', err);
    } finally {
        if (conn) conn.release();
    }
}

/**
 * Inicia a rotina automática de expiração de contratos
 * @param {Function} notifyPilotsFn Função do WebSocket para notificar pilotos
 * @param {number} intervalMs Intervalo entre verificações em ms (padrão: 30 segundos)
 */
function startContractExpirationWorker(notifyPilotsFn, intervalMs = 30000) {
    if (isWorkerRunning) {
        console.log('[ContractExpirationWorker] Worker já está em execução.');
        return;
    }

    isWorkerRunning = true;
    console.log(`[ContractExpirationWorker] Iniciado com intervalo de ${intervalMs}ms.`);

    const tick = async () => {
        if (!isWorkerRunning) return;
        try {
            await processExpiredContracts(notifyPilotsFn);
        } catch (e) {
            console.error('[ContractExpirationWorker] Falha não tratada no tick:', e);
        } finally {
            if (isWorkerRunning) {
                workerTimer = setTimeout(tick, intervalMs);
            }
        }
    };

    workerTimer = setTimeout(tick, 5000);
}

/**
 * Para o worker de forma limpa
 */
function stopContractExpirationWorker() {
    isWorkerRunning = false;
    if (workerTimer) {
        clearTimeout(workerTimer);
        workerTimer = null;
    }
    console.log('[ContractExpirationWorker] Worker finalizado.');
}

module.exports = {
    startContractExpirationWorker,
    stopContractExpirationWorker,
    processExpiredContracts
};
