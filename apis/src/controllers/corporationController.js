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

        // Busca saldo atual de créditos do piloto para validações financeiras
        const pilotW = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1", [pilotUid]);
        const pilotCredits = pilotW.length > 0 ? Number(pilotW[0].credits) : 0;

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
                    pilot_credits: pilotCredits,
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
                    pilot_credits: pilotCredits,
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
                pilot_credits: pilotCredits,
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

/**
 * Lista as estações orbitais disponíveis para fundar uma corporação (Passo 4)
 */
const getAvailableStations = async (req, res) => {
    let conn;
    try {
        conn = await db.getConnection();
        const rows = await conn.query(
            `SELECT 
                s.id AS station_id,
                s.name AS station_name,
                s.orbit_id,
                COALESCE(o.name, 'Órbita Desconhecida') AS orbit_name
             FROM orbit_stations s
             LEFT JOIN orbits o ON o.id = s.orbit_id
             ORDER BY s.name ASC`
        );

        const list = rows.map(r => ({
            station_id: Number(r.station_id),
            station_name: r.station_name,
            orbit_id: Number(r.orbit_id),
            orbit_name: r.orbit_name
        }));

        return res.json({
            status: 'sucesso',
            data: list
        });
    } catch (err) {
        console.error('[Corporation getAvailableStations Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Cria uma nova corporação (Passo 4)
 * - Taxa de abertura: 1.000.000 créditos
 * - Valida se o piloto não tem corporação nem pedido pendente
 * - Valida unicidade do nome
 * - Valida estação escolhida
 * - Valida e debita 1.000.000 CR da carteira do piloto
 * - Credita 1.000.000 CR na carteira da estação
 * - Registra a transação em wallet_transactions
 * - Insere na tabela corporations
 * - Insere o piloto como 'leader' em corporation_members
 */
const createCorporation = async (req, res) => {
    const { pilot_uid, name, station_uid } = req.body;
    const FOUNDATION_FEE = 1000000;

    if (!pilot_uid) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilot_uid é obrigatório.' });
    }

    const trimmedName = (name || '').trim();
    if (!trimmedName || trimmedName.length < 3 || trimmedName.length > 30) {
        return res.status(400).json({ status: 'erro', mensagem: 'O nome da corporação deve conter entre 3 e 30 caracteres.' });
    }

    const parsedStationId = parseInt(station_uid, 10);
    if (isNaN(parsedStationId) || parsedStationId <= 0) {
        return res.status(400).json({ status: 'erro', mensagem: 'Selecione uma estação base válida.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        // 1. Valida se o piloto já pertence a uma corporação
        const memberRows = await conn.query(
            "SELECT corporation_uid FROM corporation_members WHERE pilot_uid = ? LIMIT 1",
            [pilot_uid]
        );
        if (memberRows.length > 0) {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Você já faz parte de uma corporação. É necessário se desligar antes de fundar outra.' });
        }

        // 2. Valida se possui solicitação de ingresso pendente em outra corporação
        const pendingRows = await conn.query(
            `SELECT 1 FROM messages m
             WHERE m.uid_origin = ?
               AND m.text LIKE '%solicita ser aceito na corporação%'
               AND NOT EXISTS (
                 SELECT 1 FROM messages cancel_msg
                 WHERE cancel_msg.uid_origin = m.uid_origin
                   AND cancel_msg.uid_destination = m.uid_destination
                   AND cancel_msg.date_time > m.date_time
                   AND cancel_msg.text LIKE '%cancelou a solicitação%'
               )
             LIMIT 1`,
            [pilot_uid]
        );
        if (pendingRows.length > 0) {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Você possui uma solicitação de ingresso pendente. Cancele-a antes de fundar sua própria corporação.' });
        }

        // 3. Valida se já existe uma corporação com esse nome (case-insensitive)
        const existingNameRows = await conn.query(
            "SELECT corporation_uid FROM corporations WHERE LOWER(name) = LOWER(?) LIMIT 1",
            [trimmedName]
        );
        if (existingNameRows.length > 0) {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: `O nome "${trimmedName}" já está em uso por outra corporação estelar.` });
        }

        // 4. Valida se a estação existe
        const stationRows = await conn.query(
            "SELECT id, name FROM orbit_stations WHERE id = ? LIMIT 1",
            [parsedStationId]
        );
        if (stationRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Estação base selecionada não encontrada no setor.' });
        }
        const stationName = stationRows[0].name;

        // 5. Validação e Débito na carteira do piloto
        const pilotW = await conn.query(
            "SELECT credits FROM wallets WHERE wallet_uid = ? FOR UPDATE",
            [pilot_uid]
        );
        const pilotCredits = pilotW.length > 0 ? Number(pilotW[0].credits) : 0;
        if (pilotCredits < FOUNDATION_FEE) {
            await conn.rollback();
            return res.status(400).json({
                status: 'erro',
                mensagem: `Créditos insuficientes para fundar a corporação. Taxa necessária: 1.000.000 CR. Saldo atual: ${pilotCredits.toLocaleString('pt-BR')} CR.`
            });
        }

        const pilotAfter = pilotCredits - FOUNDATION_FEE;
        await conn.query("UPDATE wallets SET credits = ? WHERE wallet_uid = ?", [pilotAfter, pilot_uid]);

        // 6. Crédito na carteira da estação
        await conn.query(
            "INSERT IGNORE INTO wallets (wallet_uid, cash, credits) VALUES (?, 0, 1000000000)",
            [parsedStationId]
        );
        const stationW = await conn.query(
            "SELECT credits FROM wallets WHERE wallet_uid = ? FOR UPDATE",
            [parsedStationId]
        );
        const stationBefore = stationW.length > 0 ? Number(stationW[0].credits) : 1000000000;
        const stationAfter = stationBefore + FOUNDATION_FEE;
        await conn.query("UPDATE wallets SET credits = ? WHERE wallet_uid = ?", [stationAfter, parsedStationId]);

        // 7. Cria o registro da Corporação
        const corpInsert = await conn.query(
            `INSERT INTO corporations (name, founder_pilot_uid, status, created_at, station_uid, admission_fee)
             VALUES (?, ?, 'active', NOW(), ?, 0)`,
            [trimmedName, pilot_uid, parsedStationId]
        );
        const newCorpUid = Number(corpInsert.insertId);

        // 8. Registra o fundador como líder em corporation_members
        await conn.query(
            `INSERT INTO corporation_members (corporation_uid, pilot_uid, role, joined_at)
             VALUES (?, ?, 'leader', NOW())`,
            [newCorpUid, pilot_uid]
        );

        // 9. Registra o movimento financeiro em wallet_transactions
        await conn.query(
            `INSERT INTO wallet_transactions (
                wallet_from, wallet_to, amount, 
                balance_from_before, balance_from_after, 
                balance_to_before, balance_to_after, 
                operation_type, reference_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'corporation_creation', ?)`,
            [
                pilot_uid,
                parsedStationId,
                FOUNDATION_FEE,
                pilotCredits,
                pilotAfter,
                stationBefore,
                stationAfter,
                newCorpUid
            ]
        );

        await conn.commit();

        return res.status(201).json({
            status: 'sucesso',
            mensagem: `Corporação "${trimmedName}" fundada com sucesso! Você é o Comandante Líder.`,
            data: {
                corporation_uid: newCorpUid,
                name: trimmedName,
                role: 'leader',
                station_uid: parsedStationId,
                station_name: stationName,
                founder_pilot_uid: pilot_uid,
                credits_remaining: pilotAfter
            }
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[Corporation createCorporation Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Lista todas as equipes de uma corporação (corporation_teams)
 */
const getCorporationTeams = async (req, res) => {
    const corpUid = req.params.corpUid;
    if (!corpUid) return res.status(400).json({ status: 'erro', mensagem: 'corpUid é obrigatório.' });
    let conn;
    try {
        conn = await db.getConnection();
        const rows = await conn.query(
            `SELECT 
                ct.corporation_uid,
                ct.team_uid,
                ct.description,
                COUNT(cm.pilot_uid) AS members_count
             FROM corporation_teams ct
             LEFT JOIN corporation_members cm ON cm.corporation_uid = ct.corporation_uid AND cm.team_uid = ct.team_uid
             WHERE ct.corporation_uid = ?
             GROUP BY ct.corporation_uid, ct.team_uid, ct.description
             ORDER BY ct.team_uid ASC`,
            [corpUid]
        );
        const list = rows.map(r => ({
            corporation_uid: Number(r.corporation_uid),
            team_uid: Number(r.team_uid),
            description: r.description,
            members_count: Number(r.members_count || 0)
        }));
        return res.json({ status: 'sucesso', data: list });
    } catch (err) {
        console.error('[getCorporationTeams Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: 'Falha ao buscar equipes.' });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Cria uma nova equipe na tabela corporation_teams
 */
const createCorporationTeam = async (req, res) => {
    const corpUid = req.params.corpUid;
    const { description } = req.body;
    if (!corpUid || !description || !description.trim()) {
        return res.status(400).json({ status: 'erro', mensagem: 'Descrição da equipe é obrigatória.' });
    }
    let conn;
    try {
        conn = await db.getConnection();
        const maxRows = await conn.query(
            "SELECT COALESCE(MAX(team_uid), 0) AS max_id FROM corporation_teams WHERE corporation_uid = ?",
            [corpUid]
        );
        const nextTeamUid = Number(maxRows[0].max_id) + 1;
        await conn.query(
            "INSERT INTO corporation_teams (corporation_uid, team_uid, description) VALUES (?, ?, ?)",
            [corpUid, nextTeamUid, description.trim()]
        );
        return res.json({
            status: 'sucesso',
            mensagem: 'Equipe criada com sucesso.',
            data: {
                corporation_uid: Number(corpUid),
                team_uid: nextTeamUid,
                description: description.trim(),
                members_count: 0
            }
        });
    } catch (err) {
        console.error('[createCorporationTeam Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: 'Falha ao criar equipe.' });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Exclui uma equipe e desvincula os membros que pertenciam a ela
 */
const deleteCorporationTeam = async (req, res) => {
    const { corpUid, teamUid } = req.params;
    if (!corpUid || !teamUid) {
        return res.status(400).json({ status: 'erro', mensagem: 'corpUid e teamUid são obrigatórios.' });
    }
    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();
        await conn.query(
            "UPDATE corporation_members SET team_uid = NULL WHERE corporation_uid = ? AND team_uid = ?",
            [corpUid, teamUid]
        );
        await conn.query(
            "DELETE FROM corporation_teams WHERE corporation_uid = ? AND team_uid = ?",
            [corpUid, teamUid]
        );
        await conn.commit();
        return res.json({ status: 'sucesso', mensagem: 'Equipe removida com sucesso.' });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[deleteCorporationTeam Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: 'Falha ao remover equipe.' });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Lista todos os membros admitidos de uma corporação
 */
const getCorporationMembers = async (req, res) => {
    const corpUid = req.params.corpUid;
    if (!corpUid) return res.status(400).json({ status: 'erro', mensagem: 'corpUid é obrigatório.' });
    let conn;
    try {
        conn = await db.getConnection();
        const rows = await conn.query(
            `SELECT 
                cm.corporation_uid,
                cm.pilot_uid,
                cm.role,
                cm.joined_at,
                cm.team_uid,
                COALESCE(ct.description, 'Sem Equipe') AS team_name,
                COALESCE(p.pilot, 'Desconhecido') AS pilot_name,
                c.founder_pilot_uid,
                (c.founder_pilot_uid = cm.pilot_uid) AS is_founder
             FROM corporation_members cm
             INNER JOIN corporations c ON c.corporation_uid = cm.corporation_uid
             LEFT JOIN pilots p ON p.pilot_uid = cm.pilot_uid
             LEFT JOIN corporation_teams ct ON ct.corporation_uid = cm.corporation_uid AND ct.team_uid = cm.team_uid
             WHERE cm.corporation_uid = ?
             ORDER BY 
                CASE cm.role 
                    WHEN 'leader' THEN 1 
                    WHEN 'officer' THEN 2 
                    WHEN 'member' THEN 3 
                    ELSE 4 
                END, 
                cm.joined_at ASC`,
            [corpUid]
        );
        return res.json({ status: 'sucesso', data: rows });
    } catch (err) {
        console.error('[getCorporationMembers Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: 'Falha ao buscar membros.' });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Atualiza cargo (role) e/ou equipe (team_uid) de um membro admitido
 */
const updateCorporationMember = async (req, res) => {
    const { corpUid, pilotUid } = req.params;
    const { role, team_uid } = req.body;
    if (!corpUid || !pilotUid) {
        return res.status(400).json({ status: 'erro', mensagem: 'corpUid e pilotUid são obrigatórios.' });
    }
    let conn;
    try {
        conn = await db.getConnection();
        const updates = [];
        const params = [];

        if (role !== undefined) {
            const validRoles = ['leader', 'officer', 'member'];
            if (!validRoles.includes(role)) {
                return res.status(400).json({ status: 'erro', mensagem: 'Cargo inválido. Opções: leader, officer, member.' });
            }
            updates.push("role = ?");
            params.push(role);
        }

        if (team_uid !== undefined) {
            if (team_uid === null || team_uid === '' || team_uid === 0 || team_uid === 'none') {
                updates.push("team_uid = NULL");
            } else {
                const teamCheck = await conn.query(
                    "SELECT team_uid FROM corporation_teams WHERE corporation_uid = ? AND team_uid = ? LIMIT 1",
                    [corpUid, team_uid]
                );
                if (teamCheck.length === 0) {
                    return res.status(404).json({ status: 'erro', mensagem: 'Equipe não encontrada para esta corporação.' });
                }
                updates.push("team_uid = ?");
                params.push(Number(team_uid));
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ status: 'erro', mensagem: 'Nenhum campo para atualizar.' });
        }

        params.push(corpUid, pilotUid);
        await conn.query(
            `UPDATE corporation_members SET ${updates.join(', ')} WHERE corporation_uid = ? AND pilot_uid = ?`,
            params
        );

        return res.json({ status: 'sucesso', mensagem: 'Membro atualizado com sucesso.' });
    } catch (err) {
        console.error('[updateCorporationMember Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: 'Falha ao atualizar membro.' });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Desliga (exclui) um admitido da corporação
 */
const removeCorporationMember = async (req, res) => {
    const { corpUid, pilotUid } = req.params;
    if (!corpUid || !pilotUid) {
        return res.status(400).json({ status: 'erro', mensagem: 'corpUid e pilotUid são obrigatórios.' });
    }
    let conn;
    try {
        conn = await db.getConnection();
        const corpRows = await conn.query(
            "SELECT founder_pilot_uid FROM corporations WHERE corporation_uid = ? LIMIT 1",
            [corpUid]
        );
        if (corpRows.length > 0 && Number(corpRows[0].founder_pilot_uid) === Number(pilotUid)) {
            return res.status(400).json({ status: 'erro', mensagem: 'Não é possível desligar o líder fundador da corporação.' });
        }

        const result = await conn.query(
            "DELETE FROM corporation_members WHERE corporation_uid = ? AND pilot_uid = ?",
            [corpUid, pilotUid]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'erro', mensagem: 'Membro não encontrado nesta corporação.' });
        }

        return res.json({ status: 'sucesso', mensagem: 'Piloto desligado da corporação com sucesso.' });
    } catch (err) {
        console.error('[removeCorporationMember Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: 'Falha ao desligar membro.' });
    } finally {
        if (conn) conn.release();
    }
};

module.exports = {
    getCorporationStatus,
    getActiveCorporations,
    applyToCorporation,
    cancelApplication,
    getAvailableStations,
    createCorporation,
    getCorporationTeams,
    createCorporationTeam,
    deleteCorporationTeam,
    getCorporationMembers,
    updateCorporationMember,
    removeCorporationMember
};
