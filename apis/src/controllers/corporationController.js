const db = require('../config/database');

/**
 * Consulta o status de corporação do piloto
 */
const getCorporationStatus = async (req, res) => {
    const pilotUid = req.params.pilotUid || req.query.pilot_uid;
    if (!pilotUid) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilot_uid é obrigatório.' });
    }

    let conn;
    try {
        conn = await db.getConnection();

        // 1. Verifica se o piloto faz parte de alguma corporação
        const memberRows = await conn.query(
            `SELECT 
                cm.corporation_uid,
                cm.pilot_uid,
                cm.role,
                cm.joined_at,
                c.name AS corporation_name,
                c.status AS corporation_status,
                c.founder_pilot_uid,
                c.station_uid,
                COALESCE(c.admission_fee, 0) AS admission_fee,
                st.name AS station_name,
                p_founder.pilot AS founder_name
             FROM corporation_members cm
             INNER JOIN corporations c ON c.corporation_uid = cm.corporation_uid
             LEFT JOIN orbit_stations st ON st.id = c.station_uid
             LEFT JOIN pilots p_founder ON p_founder.pilot_uid = c.founder_pilot_uid
             WHERE cm.pilot_uid = ?
             LIMIT 1`,
            [pilotUid]
        );

        if (memberRows.length > 0) {
            const m = memberRows[0];
            return res.json({
                status: 'sucesso',
                data: {
                    has_corporation: true,
                    corporation: {
                        corporation_uid: Number(m.corporation_uid),
                        name: m.corporation_name,
                        role: m.role,
                        joined_at: m.joined_at,
                        status: m.corporation_status,
                        founder_pilot_uid: Number(m.founder_pilot_uid),
                        founder_name: m.founder_name || 'Desconhecido',
                        station_uid: m.station_uid != null ? Number(m.station_uid) : null,
                        station_name: m.station_name || 'Estação Desconhecida',
                        admission_fee: Number(m.admission_fee || 0),
                        is_leader: m.role === 'leader' || Number(m.founder_pilot_uid) === Number(pilotUid)
                    }
                }
            });
        }

        // 2. Não possui corporação. Verifica se possui pedido de inscrição pendente
        const pendingRows = await conn.query(
            `SELECT 
                m.date_time,
                m.uid_destination AS founder_pilot_uid,
                m.text,
                p_dest.pilot AS founder_name,
                c.corporation_uid,
                c.name AS corporation_name,
                COALESCE(c.admission_fee, 0) AS admission_fee
             FROM messages m
             INNER JOIN corporations c ON c.founder_pilot_uid = m.uid_destination
             LEFT JOIN pilots p_dest ON p_dest.pilot_uid = m.uid_destination
             WHERE m.uid_origin = ?
               AND m.text LIKE '%solicita ser aceito na corporação%'
               AND NOT EXISTS (
                 SELECT 1 FROM messages cancel_msg
                 WHERE cancel_msg.uid_origin = m.uid_origin
                   AND cancel_msg.uid_destination = m.uid_destination
                   AND cancel_msg.date_time > m.date_time
                   AND cancel_msg.text LIKE '%cancelou a solicitação%'
               )
             ORDER BY m.date_time DESC
             LIMIT 1`,
            [pilotUid]
        );

        if (pendingRows.length > 0) {
            const p = pendingRows[0];
            return res.json({
                status: 'sucesso',
                data: {
                    has_corporation: false,
                    has_pending_application: true,
                    pending_application: {
                        corporation_uid: Number(p.corporation_uid),
                        corporation_name: p.corporation_name,
                        founder_pilot_uid: Number(p.founder_pilot_uid),
                        founder_name: p.founder_name || 'Fundador',
                        date_time: p.date_time,
                        admission_fee: Number(p.admission_fee || 0)
                    }
                }
            });
        }

        // 3. Freelancer sem corporação e sem solicitações pendentes
        return res.json({
            status: 'sucesso',
            data: {
                has_corporation: false,
                has_pending_application: false
            }
        });
    } catch (err) {
        console.error('[Corporation getCorporationStatus Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Lista todas as corporações ativas
 */
const getActiveCorporations = async (req, res) => {
    let conn;
    try {
        conn = await db.getConnection();
        const rows = await conn.query(
            `SELECT 
                c.corporation_uid,
                c.name,
                c.founder_pilot_uid,
                COALESCE(p.pilot, 'Comandante') AS founder_name,
                c.station_uid,
                COALESCE(st.name, 'Não Definida') AS station_name,
                COALESCE(c.admission_fee, 0) AS admission_fee,
                COUNT(cm.pilot_uid) AS members_count,
                c.created_at
             FROM corporations c
             LEFT JOIN pilots p ON p.pilot_uid = c.founder_pilot_uid
             LEFT JOIN orbit_stations st ON st.id = c.station_uid
             LEFT JOIN corporation_members cm ON cm.corporation_uid = c.corporation_uid
             WHERE c.status = 'active'
             GROUP BY c.corporation_uid
             ORDER BY c.name ASC`
        );

        const list = rows.map(r => ({
            corporation_uid: Number(r.corporation_uid),
            name: r.name,
            founder_pilot_uid: Number(r.founder_pilot_uid),
            founder_name: r.founder_name,
            station_uid: r.station_uid != null ? Number(r.station_uid) : null,
            station_name: r.station_name,
            admission_fee: Number(r.admission_fee || 0),
            members_count: Number(r.members_count || 0),
            created_at: r.created_at
        }));

        return res.json({
            status: 'sucesso',
            data: list
        });
    } catch (err) {
        console.error('[Corporation getActiveCorporations Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Envia solicitacao de inscricao numa corporacao (Passo 2)
 */
const applyToCorporation = async (req, res) => {
    const { pilot_uid, corporation_uid } = req.body;
    if (!pilot_uid || !corporation_uid) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilot_uid e corporation_uid são obrigatórios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        // 1. Verifica se o piloto ja pertence a uma corporacao
        const memberRows = await conn.query(
            "SELECT corporation_uid FROM corporation_members WHERE pilot_uid = ? LIMIT 1",
            [pilot_uid]
        );
        if (memberRows.length > 0) {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Você já faz parte de uma corporação. É necessário se desligar antes de se inscrever em outra.' });
        }

        // 2. Busca informacoes do piloto
        const pilotRows = await conn.query(
            "SELECT pilot FROM pilots WHERE pilot_uid = ? LIMIT 1",
            [pilot_uid]
        );
        const pilotName = pilotRows.length > 0 ? pilotRows[0].pilot : `Piloto #${pilot_uid}`;

        // 3. Busca informacoes da corporacao
        const corpRows = await conn.query(
            "SELECT corporation_uid, name, founder_pilot_uid, status FROM corporations WHERE corporation_uid = ? LIMIT 1",
            [corporation_uid]
        );
        if (corpRows.length === 0 || corpRows[0].status !== 'active') {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Corporação não encontrada ou inativa.' });
        }
        const corp = corpRows[0];
        const founderUid = Number(corp.founder_pilot_uid);

        // 4. Garante que o piloto solicitante esteja na lista de contatos do fundador para exibição no canal
        const existingContact = await conn.query(
            "SELECT 1 FROM pilot_contacts WHERE pilot_uid = ? AND contact_uid = ? LIMIT 1",
            [founderUid, pilot_uid]
        );
        if (existingContact.length === 0) {
            await conn.query(
                "INSERT INTO pilot_contacts (pilot_uid, contact_uid) VALUES (?, ?)",
                [founderUid, pilot_uid]
            );
        }

        // 5. Insere a mensagem de e-mail (type = 1, uid_channel = 6 [Contatos], uid_subchannel = pilot_uid)
        const messageText = `O piloto ${pilotName} solicita ser aceito na corporação ${corp.name}.`;
        await conn.query(
            `INSERT INTO messages (type, date_time, uid_destination, uid_origin, text, uid_channel, uid_subchannel, status, is_read)
             VALUES (1, NOW(), ?, ?, ?, 6, ?, 2, 0)`,
            [founderUid, pilot_uid, messageText, pilot_uid]
        );

        await conn.commit();

        // 6. Notificação em tempo real via WebSocket para o fundador
        if (req.app && req.app.locals && req.app.locals.notifyPilots) {
            req.app.locals.notifyPilots([founderUid], {
                type: 'EMAIL_NOTIFICATION',
                data: {
                    channel_uid: 6,
                    subchannel_uid: Number(pilot_uid),
                    sender_uid: Number(pilot_uid),
                    message_text: messageText,
                    timestamp: new Date().toISOString()
                }
            });
        }

        return res.json({
            status: 'sucesso',
            mensagem: `Solicitação enviada com sucesso ao líder fundador da ${corp.name}! Aguarde a aprovação.`,
            data: {
                corporation_uid: Number(corp.corporation_uid),
                corporation_name: corp.name,
                founder_pilot_uid: founderUid
            }
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[Corporation applyToCorporation Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Cancela solicitacao de inscricao pendente (Passo 3)
 */
const cancelApplication = async (req, res) => {
    const { pilot_uid } = req.body;
    if (!pilot_uid) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilot_uid é obrigatório.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        // 1. Busca a ultima solicitacao pendente do piloto
        const pendingRows = await conn.query(
            `SELECT 
                m.date_time,
                m.uid_destination AS founder_pilot_uid,
                c.corporation_uid,
                c.name AS corporation_name
             FROM messages m
             INNER JOIN corporations c ON c.founder_pilot_uid = m.uid_destination
             WHERE m.uid_origin = ?
               AND m.text LIKE '%solicita ser aceito na corporação%'
               AND NOT EXISTS (
                 SELECT 1 FROM messages cancel_msg
                 WHERE cancel_msg.uid_origin = m.uid_origin
                   AND cancel_msg.uid_destination = m.uid_destination
                   AND cancel_msg.date_time > m.date_time
                   AND cancel_msg.text LIKE '%cancelou a solicitação%'
               )
             ORDER BY m.date_time DESC
             LIMIT 1`,
            [pilot_uid]
        );

        if (pendingRows.length === 0) {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Nenhuma solicitação pendente encontrada para cancelar.' });
        }

        const pending = pendingRows[0];
        const founderUid = Number(pending.founder_pilot_uid);
        const corpName = pending.corporation_name;

        // 2. Busca nome do piloto
        const pilotRows = await conn.query("SELECT pilot FROM pilots WHERE pilot_uid = ? LIMIT 1", [pilot_uid]);
        const pilotName = pilotRows.length > 0 ? pilotRows[0].pilot : `Piloto #${pilot_uid}`;

        // 3. Insere a mensagem de cancelamento (e-mail type = 1, canal 6, subcanal = pilot_uid)
        const cancelText = `O piloto ${pilotName} cancelou a solicitação de admissão na corporação ${corpName}.`;
        await conn.query(
            `INSERT INTO messages (type, date_time, uid_destination, uid_origin, text, uid_channel, uid_subchannel, status, is_read)
             VALUES (1, NOW(), ?, ?, ?, 6, ?, 2, 0)`,
            [founderUid, pilot_uid, cancelText, pilot_uid]
        );

        await conn.commit();

        // 4. Notificação em tempo real via WebSocket para o fundador
        if (req.app && req.app.locals && req.app.locals.notifyPilots) {
            req.app.locals.notifyPilots([founderUid], {
                type: 'EMAIL_NOTIFICATION',
                data: {
                    channel_uid: 6,
                    subchannel_uid: Number(pilot_uid),
                    sender_uid: Number(pilot_uid),
                    message_text: cancelText,
                    timestamp: new Date().toISOString()
                }
            });
        }

        return res.json({
            status: 'sucesso',
            mensagem: `Solicitação de admissão na corporação ${corpName} cancelada com sucesso!`,
            data: {
                corporation_uid: Number(pending.corporation_uid),
                corporation_name: corpName
            }
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[Corporation cancelApplication Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

module.exports = {
    getCorporationStatus,
    getActiveCorporations,
    applyToCorporation,
    cancelApplication
};
