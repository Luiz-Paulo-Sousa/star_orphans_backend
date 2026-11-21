const db = require('../config/database');

/**
 * Consulta o status de corporaÃ§Ã£o do piloto
 */
const getCorporationStatus = async (req, res) => {
    const pilotUid = req.params.pilotUid || req.query.pilot_uid;
    if (!pilotUid) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilot_uid Ã© obrigatÃ³rio.' });
    }

    let conn;
    try {
        conn = await db.getConnection();

        // Busca saldo atual de crÃ©ditos do piloto para validaÃ§Ãµes financeiras
        const pilotW = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1", [pilotUid]);
        const pilotCredits = pilotW.length > 0 ? Number(pilotW[0].credits) : 0;

        // 1. Verifica se o piloto faz parte de alguma corporaÃ§Ã£o
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
                        station_name: m.station_name || 'EstaÃ§Ã£o Desconhecida',
                        admission_fee: Number(m.admission_fee || 0),
                        is_leader: m.role === 'leader' || Number(m.founder_pilot_uid) === Number(pilotUid)
                    }
                }
            });
        }

        // 2. NÃ£o possui corporaÃ§Ã£o. Verifica se possui pedido de inscriÃ§Ã£o pendente
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
               AND m.text LIKE '%solicita ser aceito na corporaÃ§Ã£o%'
               AND NOT EXISTS (
                 SELECT 1 FROM messages cancel_msg
                 WHERE cancel_msg.uid_origin = m.uid_origin
                   AND cancel_msg.uid_destination = m.uid_destination
                   AND cancel_msg.date_time > m.date_time
                   AND cancel_msg.text LIKE '%cancelou a solicitaÃ§Ã£o%'
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

        // 3. Freelancer sem corporaÃ§Ã£o e sem solicitaÃ§Ãµes pendentes
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
 * Lista todas as corporaÃ§Ãµes ativas
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
                COALESCE(st.name, 'NÃ£o Definida') AS station_name,
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
        return res.status(400).json({ status: 'erro', mensagem: 'pilot_uid e corporation_uid sÃ£o obrigatÃ³rios.' });
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
            return res.status(400).json({ status: 'erro', mensagem: 'VocÃª jÃ¡ faz parte de uma corporaÃ§Ã£o. Ã‰ necessÃ¡rio se desligar antes de se inscrever em outra.' });
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
            return res.status(404).json({ status: 'erro', mensagem: 'CorporaÃ§Ã£o nÃ£o encontrada ou inativa.' });
        }
        const corp = corpRows[0];
        const founderUid = Number(corp.founder_pilot_uid);

        // 4. Garante que o piloto solicitante esteja na lista de contatos do fundador para exibiÃ§Ã£o no canal
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
        const messageText = `O piloto ${pilotName} solicita ser aceito na corporaÃ§Ã£o ${corp.name}.`;
        await conn.query(
            `INSERT INTO messages (type, date_time, uid_destination, uid_origin, text, uid_channel, uid_subchannel, status, is_read)
             VALUES (1, NOW(), ?, ?, ?, 6, ?, 2, 0)`,
            [founderUid, pilot_uid, messageText, pilot_uid]
        );

        await conn.commit();

        // 6. NotificaÃ§Ã£o em tempo real via WebSocket para o fundador
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
            mensagem: `SolicitaÃ§Ã£o enviada com sucesso ao lÃ­der fundador da ${corp.name}! Aguarde a aprovaÃ§Ã£o.`,
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
        return res.status(400).json({ status: 'erro', mensagem: 'pilot_uid Ã© obrigatÃ³rio.' });
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
               AND m.text LIKE '%solicita ser aceito na corporaÃ§Ã£o%'
               AND NOT EXISTS (
                 SELECT 1 FROM messages cancel_msg
                 WHERE cancel_msg.uid_origin = m.uid_origin
                   AND cancel_msg.uid_destination = m.uid_destination
                   AND cancel_msg.date_time > m.date_time
                   AND cancel_msg.text LIKE '%cancelou a solicitaÃ§Ã£o%'
               )
             ORDER BY m.date_time DESC
             LIMIT 1`,
            [pilot_uid]
        );

        if (pendingRows.length === 0) {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Nenhuma solicitaÃ§Ã£o pendente encontrada para cancelar.' });
        }

        const pending = pendingRows[0];
        const founderUid = Number(pending.founder_pilot_uid);
        const corpName = pending.corporation_name;

        // 2. Busca nome do piloto
        const pilotRows = await conn.query("SELECT pilot FROM pilots WHERE pilot_uid = ? LIMIT 1", [pilot_uid]);
        const pilotName = pilotRows.length > 0 ? pilotRows[0].pilot : `Piloto #${pilot_uid}`;

        // 3. Insere a mensagem de cancelamento (e-mail type = 1, canal 6, subcanal = pilot_uid)
        const cancelText = `O piloto ${pilotName} cancelou a solicitaÃ§Ã£o de admissÃ£o na corporaÃ§Ã£o ${corpName}.`;
        await conn.query(
            `INSERT INTO messages (type, date_time, uid_destination, uid_origin, text, uid_channel, uid_subchannel, status, is_read)
             VALUES (1, NOW(), ?, ?, ?, 6, ?, 2, 0)`,
            [founderUid, pilot_uid, cancelText, pilot_uid]
        );

        await conn.commit();

        // 4. NotificaÃ§Ã£o em tempo real via WebSocket para o fundador
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
            mensagem: `SolicitaÃ§Ã£o de admissÃ£o na corporaÃ§Ã£o ${corpName} cancelada com sucesso!`,
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
 * Lista as estaÃ§Ãµes orbitais disponÃ­veis para fundar uma corporaÃ§Ã£o (Passo 4)
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
                COALESCE(o.name, 'Ã“rbita Desconhecida') AS orbit_name
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
 * Cria uma nova corporaÃ§Ã£o (Passo 4)
 * - Taxa de abertura: 1.000.000 crÃ©ditos
 * - Valida se o piloto nÃ£o tem corporaÃ§Ã£o nem pedido pendente
 * - Valida unicidade do nome
 * - Valida estaÃ§Ã£o escolhida
 * - Valida e debita 1.000.000 CR da carteira do piloto
 * - Credita 1.000.000 CR na carteira da estaÃ§Ã£o
 * - Registra a transaÃ§Ã£o em wallet_transactions
 * - Insere na tabela corporations
 * - Insere o piloto como 'leader' em corporation_members
 */
const createCorporation = async (req, res) => {
    const { pilot_uid, name, station_uid } = req.body;
    const FOUNDATION_FEE = 1000000;

    if (!pilot_uid) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilot_uid Ã© obrigatÃ³rio.' });
    }

    const trimmedName = (name || '').trim();
    if (!trimmedName || trimmedName.length < 3 || trimmedName.length > 30) {
        return res.status(400).json({ status: 'erro', mensagem: 'O nome da corporaÃ§Ã£o deve conter entre 3 e 30 caracteres.' });
    }

    const parsedStationId = parseInt(station_uid, 10);
    if (isNaN(parsedStationId) || parsedStationId <= 0) {
        return res.status(400).json({ status: 'erro', mensagem: 'Selecione uma estaÃ§Ã£o base vÃ¡lida.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        // 1. Valida se o piloto jÃ¡ pertence a uma corporaÃ§Ã£o
        const memberRows = await conn.query(
            "SELECT corporation_uid FROM corporation_members WHERE pilot_uid = ? LIMIT 1",
            [pilot_uid]
        );
        if (memberRows.length > 0) {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'VocÃª jÃ¡ faz parte de uma corporaÃ§Ã£o. Ã‰ necessÃ¡rio se desligar antes de fundar outra.' });
        }

        // 2. Valida se possui solicitaÃ§Ã£o de ingresso pendente em outra corporaÃ§Ã£o
        const pendingRows = await conn.query(
            `SELECT 1 FROM messages m
             WHERE m.uid_origin = ?
               AND m.text LIKE '%solicita ser aceito na corporaÃ§Ã£o%'
               AND NOT EXISTS (
                 SELECT 1 FROM messages cancel_msg
                 WHERE cancel_msg.uid_origin = m.uid_origin
                   AND cancel_msg.uid_destination = m.uid_destination
                   AND cancel_msg.date_time > m.date_time
                   AND cancel_msg.text LIKE '%cancelou a solicitaÃ§Ã£o%'
               )
             LIMIT 1`,
            [pilot_uid]
        );
        if (pendingRows.length > 0) {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'VocÃª possui uma solicitaÃ§Ã£o de ingresso pendente. Cancele-a antes de fundar sua prÃ³pria corporaÃ§Ã£o.' });
        }

        // 3. Valida se jÃ¡ existe uma corporaÃ§Ã£o com esse nome (case-insensitive)
        const existingNameRows = await conn.query(
            "SELECT corporation_uid FROM corporations WHERE LOWER(name) = LOWER(?) LIMIT 1",
            [trimmedName]
        );
        if (existingNameRows.length > 0) {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: `O nome "${trimmedName}" jÃ¡ estÃ¡ em uso por outra corporaÃ§Ã£o estelar.` });
        }

        // 4. Valida se a estaÃ§Ã£o existe
        const stationRows = await conn.query(
            "SELECT id, name FROM orbit_stations WHERE id = ? LIMIT 1",
            [parsedStationId]
        );
        if (stationRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'EstaÃ§Ã£o base selecionada nÃ£o encontrada no setor.' });
        }
        const stationName = stationRows[0].name;

        // 5. ValidaÃ§Ã£o e DÃ©bito na carteira do piloto
        const pilotW = await conn.query(
            "SELECT credits FROM wallets WHERE wallet_uid = ? FOR UPDATE",
            [pilot_uid]
        );
        const pilotCredits = pilotW.length > 0 ? Number(pilotW[0].credits) : 0;
        if (pilotCredits < FOUNDATION_FEE) {
            await conn.rollback();
            return res.status(400).json({
                status: 'erro',
                mensagem: `CrÃ©ditos insuficientes para fundar a corporaÃ§Ã£o. Taxa necessÃ¡ria: 1.000.000 CR. Saldo atual: ${pilotCredits.toLocaleString('pt-BR')} CR.`
            });
        }

        const pilotAfter = pilotCredits - FOUNDATION_FEE;
        await conn.query("UPDATE wallets SET credits = ? WHERE wallet_uid = ?", [pilotAfter, pilot_uid]);

        // 6. CrÃ©dito na carteira da estaÃ§Ã£o
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

        // 7. Cria o registro da CorporaÃ§Ã£o
        const corpInsert = await conn.query(
            `INSERT INTO corporations (name, founder_pilot_uid, status, created_at, station_uid, admission_fee)
             VALUES (?, ?, 'active', NOW(), ?, 0)`,
            [trimmedName, pilot_uid, parsedStationId]
        );
        const newCorpUid = Number(corpInsert.insertId);

        // 8. Registra o fundador como lÃ­der em corporation_members
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
            mensagem: `CorporaÃ§Ã£o "${trimmedName}" fundada com sucesso! VocÃª Ã© o Comandante LÃ­der.`,
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
 * Lista todas as equipes de uma corporaÃ§Ã£o (corporation_teams)
 */
const getCorporationTeams = async (req, res) => {
    const corpUid = req.params.corpUid;
    if (!corpUid) return res.status(400).json({ status: 'erro', mensagem: 'corpUid Ã© obrigatÃ³rio.' });
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
        return res.status(400).json({ status: 'erro', mensagem: 'DescriÃ§Ã£o da equipe Ã© obrigatÃ³ria.' });
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
        return res.status(400).json({ status: 'erro', mensagem: 'corpUid e teamUid sÃ£o obrigatÃ³rios.' });
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
 * Lista todos os membros admitidos de uma corporaÃ§Ã£o
 */
const getCorporationMembers = async (req, res) => {
    const corpUid = req.params.corpUid;
    if (!corpUid) return res.status(400).json({ status: 'erro', mensagem: 'corpUid Ã© obrigatÃ³rio.' });
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
        return res.status(400).json({ status: 'erro', mensagem: 'corpUid e pilotUid sÃ£o obrigatÃ³rios.' });
    }
    let conn;
    try {
        conn = await db.getConnection();
        const updates = [];
        const params = [];

        if (role !== undefined) {
            const validRoles = ['leader', 'officer', 'member'];
            if (!validRoles.includes(role)) {
                return res.status(400).json({ status: 'erro', mensagem: 'Cargo invÃ¡lido. OpÃ§Ãµes: leader, officer, member.' });
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
                    return res.status(404).json({ status: 'erro', mensagem: 'Equipe nÃ£o encontrada para esta corporaÃ§Ã£o.' });
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
 * Desliga (exclui) um admitido da corporaÃ§Ã£o
 */
const removeCorporationMember = async (req, res) => {
    const { corpUid, pilotUid } = req.params;
    if (!corpUid || !pilotUid) {
        return res.status(400).json({ status: 'erro', mensagem: 'corpUid e pilotUid sÃ£o obrigatÃ³rios.' });
    }
    let conn;
    try {
        conn = await db.getConnection();
        const corpRows = await conn.query(
            "SELECT founder_pilot_uid FROM corporations WHERE corporation_uid = ? LIMIT 1",
            [corpUid]
        );
        if (corpRows.length > 0 && Number(corpRows[0].founder_pilot_uid) === Number(pilotUid)) {
            return res.status(400).json({ status: 'erro', mensagem: 'NÃ£o Ã© possÃ­vel desligar o lÃ­der fundador da corporaÃ§Ã£o.' });
        }

        const result = await conn.query(
            "DELETE FROM corporation_members WHERE corporation_uid = ? AND pilot_uid = ?",
            [corpUid, pilotUid]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'erro', mensagem: 'Membro nÃ£o encontrado nesta corporaÃ§Ã£o.' });
        }

        return res.json({ status: 'sucesso', mensagem: 'Piloto desligado da corporaÃ§Ã£o com sucesso.' });
    } catch (err) {
        console.error('[removeCorporationMember Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: 'Falha ao desligar membro.' });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Garante a criação da tabela de transações de itens da corporação
 */
async function ensureCorporationItemTransactionsTable(conn) {
    await conn.query(`
        CREATE TABLE IF NOT EXISTS corporation_item_transactions (
            transaction_uid INT AUTO_INCREMENT PRIMARY KEY,
            corporation_uid INT NOT NULL,
            pilot_uid INT NOT NULL,
            operator_pilot_uid INT NOT NULL,
            item_code INT NOT NULL,
            item_name VARCHAR(120) NOT NULL,
            item_type INT DEFAULT 1,
            quantity INT NOT NULL,
            direction VARCHAR(20) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_cit_corp (corporation_uid),
            INDEX idx_cit_pilot (pilot_uid)
        )
    `);
}

/**
 * Helper para detectar se a tabela é market_itens ou market_items
 */
async function getMarketTableName(conn) {
    try {
        const rows = await conn.query("SHOW TABLES LIKE 'market_itens'");
        if (rows && rows.length > 0) return 'market_itens';
    } catch (e) {}
    return 'market_items';
}

/**
 * Garante que a coluna corporation_uid exista na tabela do mercado
 */
async function ensureCorporationUidColumn(conn, marketTable) {
    try {
        const cols = await conn.query(`SHOW COLUMNS FROM ${marketTable} LIKE 'corporation_uid'`);
        if (cols.length === 0) {
            await conn.query(`ALTER TABLE ${marketTable} ADD COLUMN corporation_uid INT NULL DEFAULT NULL`);
        }
    } catch (e) {
        console.warn(`[ensureCorporationUidColumn Warning]:`, e.message);
    }
}

/**
 * Lista itens presentes na área de carga / hangar da corporação
 */
const getCorporationItems = async (req, res) => {
    const corpUid = req.params.corpUid;
    if (!corpUid) return res.status(400).json({ status: 'erro', mensagem: 'corpUid é obrigatório.' });

    let conn;
    try {
        conn = await db.getConnection();
        const marketTable = await getMarketTableName(conn);
        await ensureCorporationUidColumn(conn, marketTable);

        const corpRows = await conn.query(
            "SELECT corporation_uid, name, station_uid, founder_pilot_uid FROM corporations WHERE corporation_uid = ? LIMIT 1",
            [corpUid]
        );
        if (corpRows.length === 0) {
            return res.status(404).json({ status: 'erro', mensagem: 'Corporação não encontrada.' });
        }
        const corp = corpRows[0];

        const itemRows = await conn.query(
            `SELECT 
                mi.item_code,
                mi.stock AS amount,
                i.name,
                COALESCE(i.item_type, 1) AS item_type,
                COALESCE(i.volume, 1) AS volume,
                i.image
             FROM ${marketTable} mi
             INNER JOIN items i ON i.item_code = mi.item_code
             WHERE mi.corporation_uid = ? AND mi.stock > 0
             ORDER BY i.item_type ASC, i.name ASC`,
            [corpUid]
        );

        let totalUsedVol = 0;
        const maxVol = 100000;

        const items = itemRows.map(r => {
            const amount = Number(r.amount);
            const unitVol = Number(r.volume || 1);
            const totalVol = amount * unitVol;
            totalUsedVol += totalVol;

            let img = r.image || null;
            if (img && typeof img === 'string') {
                if (img.toLowerCase().endsWith('.svg')) {
                    img = img.replace(/\.svg$/i, '.png');
                }
                if (!img.startsWith('http') && !img.startsWith('/')) {
                    img = `/items/${img}`;
                }
            }

            return {
                item_code: Number(r.item_code),
                name: String(r.name || '').toUpperCase(),
                item_type: Number(r.item_type),
                amount,
                unit_volume: unitVol,
                volume: unitVol,
                total_volume: totalVol,
                image_url: img
            };
        });

        return res.json({
            status: 'sucesso',
            data: {
                corporation_uid: Number(corp.corporation_uid),
                station_uid: corp.station_uid,
                max_volume: maxVol,
                used_volume: totalUsedVol,
                available_volume: Math.max(0, maxVol - totalUsedVol),
                items
            }
        });
    } catch (err) {
        console.error('[getCorporationItems Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Consulta a área de carga (hangar) de um membro específico da corporação
 * Retorna tanto itens normais de hangar quanto espaçonaves (tipo 6) atracadas na estação!
 */
const getCorporationMemberHangar = async (req, res) => {
    const { corpUid, pilotUid } = req.params;
    if (!corpUid || !pilotUid) {
        return res.status(400).json({ status: 'erro', mensagem: 'corpUid e pilotUid são obrigatórios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();

        const corpRows = await conn.query(
            "SELECT station_uid FROM corporations WHERE corporation_uid = ? LIMIT 1",
            [corpUid]
        );
        const corpStationId = corpRows.length > 0 ? Number(corpRows[0].station_uid) : 1;

        const pilotRows = await conn.query(
            "SELECT pilot_uid, pilot AS pilot_name, orbit, station FROM pilots WHERE pilot_uid = ? LIMIT 1",
            [pilotUid]
        );
        if (pilotRows.length === 0) {
            return res.status(404).json({ status: 'erro', mensagem: 'Piloto não encontrado.' });
        }
        const pilot = pilotRows[0];
        const targetStationId = Number(pilot.station) || corpStationId;

        // 1. Busca container de hangar do piloto nesta estação
        let contRows = await conn.query(
            "SELECT container_uid, max_volume, current_volume FROM containers WHERE owner = ? AND storage = ? AND type = 'hangar' LIMIT 1",
            [pilotUid, targetStationId]
        );

        let containerUid;
        let maxVol = 50000;
        if (contRows.length === 0) {
            // Tenta encontrar qualquer container do tipo hangar deste piloto caso o storage seja diferente
            const fallbackCont = await conn.query(
                "SELECT container_uid, max_volume, current_volume, storage FROM containers WHERE owner = ? AND type = 'hangar' ORDER BY current_volume DESC LIMIT 1",
                [pilotUid]
            );
            if (fallbackCont.length > 0) {
                containerUid = Number(fallbackCont[0].container_uid);
                maxVol = Number(fallbackCont[0].max_volume) || 50000;
            } else {
                const resInsert = await conn.query(
                    "INSERT INTO containers (owner, storage, type, max_volume, current_volume, protected) VALUES (?, ?, 'hangar', 50000, 0, 'y')",
                    [pilotUid, targetStationId]
                );
                containerUid = Number(resInsert.insertId);
            }
        } else {
            containerUid = Number(contRows[0].container_uid);
            maxVol = Number(contRows[0].max_volume) || 50000;
        }

        // 2. Busca itens de suprimentos / equipamentos no container
        const slotRows = await conn.query(
            `SELECT cs.slot, cs.item_code, cs.amount,
                    i.name, COALESCE(i.item_type, 1) AS item_type, COALESCE(i.volume, 1) AS volume, i.image
             FROM container_slots cs
             INNER JOIN items i ON i.item_code = cs.item_code
             WHERE cs.container_uid = ? AND cs.amount > 0
             ORDER BY i.item_type ASC, i.name ASC`,
            [containerUid]
        );

        let usedVol = 0;
        const items = slotRows.map(r => {
            const amount = Number(r.amount);
            const unitVol = Number(r.volume || 1);
            const totalVol = amount * unitVol;
            usedVol += totalVol;

            let img = r.image || null;
            if (img && typeof img === 'string') {
                if (img.toLowerCase().endsWith('.svg')) {
                    img = img.replace(/\.svg$/i, '.png');
                }
                if (!img.startsWith('http') && !img.startsWith('/')) {
                    img = `/items/${img}`;
                }
            }

            return {
                item_code: Number(r.item_code),
                name: String(r.name || '').toUpperCase(),
                item_type: Number(r.item_type),
                amount,
                unit_volume: unitVol,
                volume: unitVol,
                total_volume: totalVol,
                image_url: img
            };
        });

        // 3. Busca naves (item_type = 6) atracadas pelo piloto
        try {
            const vesselRows = await conn.query(
                `SELECT v.item_code, COUNT(v.vessel_uid) AS amount,
                        COALESCE(i.name, 'Nave Estelar') AS name, 6 AS item_type,
                        COALESCE(i.volume, 1000) AS volume, i.image
                 FROM vessels v
                 INNER JOIN items i ON i.item_code = v.item_code
                 WHERE v.pilot_uid = ? AND (v.station = ? OR v.station IS NULL) AND (v.selected = 'n' OR v.selected IS NULL OR v.selected = '0')
                 GROUP BY v.item_code, i.name, i.volume, i.image
                 ORDER BY i.name ASC`,
                [pilotUid, targetStationId]
            );

            for (const v of vesselRows) {
                const amount = Number(v.amount);
                const unitVol = Number(v.volume || 1000);
                let img = v.image || null;
                if (img && typeof img === 'string') {
                    if (img.toLowerCase().endsWith('.svg')) {
                        img = img.replace(/\.svg$/i, '.png');
                    }
                    if (!img.startsWith('http') && !img.startsWith('/')) {
                        img = `/hologramas/${img}`;
                    }
                }
                items.push({
                    item_code: Number(v.item_code),
                    name: String(v.name || '').toUpperCase(),
                    item_type: 6,
                    amount,
                    unit_volume: unitVol,
                    volume: unitVol,
                    total_volume: amount * unitVol,
                    image_url: img
                });
            }
        } catch (vErr) {
            console.warn('[getCorporationMemberHangar vessels Warning]:', vErr.message);
        }

        if (containerUid) {
            await conn.query("UPDATE containers SET current_volume = ? WHERE container_uid = ?", [usedVol, containerUid]);
        }

        return res.json({
            status: 'sucesso',
            data: {
                pilot_uid: Number(pilot.pilot_uid),
                pilot_name: pilot.pilot_name,
                station_id: targetStationId,
                max_volume: maxVol,
                used_volume: usedVol,
                available_volume: Math.max(0, maxVol - usedVol),
                items
            }
        });
    } catch (err) {
        console.error('[getCorporationMemberHangar Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Executa a transferência de itens ou naves entre o Membro e a Corporação
 */
const transferCorporationItem = async (req, res) => {
    const corpUid = req.params.corpUid;
    const { pilot_uid, item_code, quantity, direction, operator_pilot_uid } = req.body;
    const qty = parseInt(quantity, 10);
    const itCode = Number(item_code);
    const memberUid = Number(pilot_uid);
    const operatorUid = Number(operator_pilot_uid || memberUid);

    if (!corpUid || !memberUid || !itCode || !qty || qty <= 0 || !direction) {
        return res.status(400).json({ status: 'erro', mensagem: 'Parâmetros inválidos para transferência.' });
    }

    if (direction !== 'TO_CORPORATION' && direction !== 'TO_MEMBER') {
        return res.status(400).json({ status: 'erro', mensagem: "Direção inválida. Use 'TO_CORPORATION' ou 'TO_MEMBER'." });
    }

    let conn;
    try {
        conn = await db.getConnection();
        const marketTable = await getMarketTableName(conn);
        await conn.beginTransaction();

        const corpRows = await conn.query(
            "SELECT corporation_uid, name, founder_pilot_uid, station_uid FROM corporations WHERE corporation_uid = ? LIMIT 1",
            [corpUid]
        );
        if (corpRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Corporação não encontrada.' });
        }
        const corp = corpRows[0];
        const founderUid = Number(corp.founder_pilot_uid);
        const corpStationId = Number(corp.station_uid || 1);

        // Validação de permissões: apenas Líder e Oficiais podem transferir itens da corporação para membros
        if (direction === 'TO_MEMBER') {
            const opMemberRows = await conn.query(
                "SELECT role FROM corporation_members WHERE corporation_uid = ? AND pilot_uid = ? LIMIT 1",
                [corpUid, operatorUid]
            );
            const isFounder = operatorUid === founderUid;
            const opRole = opMemberRows.length > 0 ? String(opMemberRows[0].role).toLowerCase() : '';
            const canManage = isFounder || opRole === 'leader' || opRole === 'officer';
            if (!canManage) {
                await conn.rollback();
                return res.status(403).json({
                    status: 'erro',
                    mensagem: 'Apenas o Líder e Oficiais podem transferir itens da corporação para membros.'
                });
            }
        }

        // Validação de segurança: apenas o próprio membro pode doar itens do seu armazém para a corporação
        if (direction === 'TO_CORPORATION') {
            if (operatorUid !== memberUid) {
                await conn.rollback();
                return res.status(403).json({
                    status: 'erro',
                    mensagem: 'Você só pode doar itens do seu próprio armazém para a corporação.'
                });
            }
        }

        const itemRows = await conn.query(
            "SELECT item_code, name, COALESCE(item_type, 1) AS item_type, COALESCE(volume, 1) AS volume FROM items WHERE item_code = ? LIMIT 1",
            [itCode]
        );
        if (itemRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Item não encontrado.' });
        }
        const item = itemRows[0];
        const itemName = item.name || `ITEM #${itCode}`;
        const itemType = Number(item.item_type || 1);
        const isShip = itemType === 6;

        const pilotRows = await conn.query("SELECT orbit, station FROM pilots WHERE pilot_uid = ? LIMIT 1", [memberUid]);
        const memberStationId = pilotRows.length > 0 ? Number(pilotRows[0].station) || corpStationId : corpStationId;
        const memberOrbitId = pilotRows.length > 0 ? Number(pilotRows[0].orbit) || 2 : 2;

        if (isShip) {
            // ==========================================
            // TRANSFERÊNCIA DE NAVE (item_type = 6)
            // ==========================================
            if (direction === 'TO_CORPORATION') {
                const availableVessels = await conn.query(
                    "SELECT vessel_uid, selected FROM vessels WHERE pilot_uid = ? AND item_code = ? AND (selected = 'n' OR selected IS NULL OR selected = '0') ORDER BY vessel_uid DESC FOR UPDATE",
                    [memberUid, itCode]
                );

                if (availableVessels.length < qty) {
                    await conn.rollback();
                    return res.status(400).json({
                        status: 'erro',
                        mensagem: `Você não possui naves inativas deste modelo para doar (disponível no hangar: ${availableVessels.length}). Naves em operação ativa não podem ser doadas.`
                    });
                }

                // Remove a(s) nave(s) do piloto e containers associados
                const vesselsToMove = availableVessels.slice(0, qty);
                for (const v of vesselsToMove) {
                    await conn.query("DELETE FROM containers WHERE storage = ? AND type = 'vessel_cargo'", [v.vessel_uid]);
                    await conn.query("DELETE FROM vessels WHERE vessel_uid = ? AND pilot_uid = ?", [v.vessel_uid, memberUid]);
                }

                // Adiciona ao estoque da corporação no market_items
                const corpShipRow = await conn.query(
                    `SELECT stock FROM ${marketTable} WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ? LIMIT 1 FOR UPDATE`,
                    [corpStationId, itCode, founderUid]
                );
                if (corpShipRow.length > 0) {
                    await conn.query(
                        `UPDATE ${marketTable} SET stock = stock + ?, corporation_uid = ? WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ?`,
                        [qty, corpUid, corpStationId, itCode, founderUid]
                    );
                } else {
                    await conn.query(
                        `INSERT INTO ${marketTable} (market_uid, item_code, owner_pilot_uid, corporation_uid, stock, ideal_stock, selling_price, buying_price, base_price)
                         VALUES (?, ?, ?, ?, ?, 100, 0, 0, 0)
                         ON DUPLICATE KEY UPDATE stock = stock + VALUES(stock), corporation_uid = VALUES(corporation_uid)`,
                        [corpStationId, itCode, founderUid, corpUid, qty]
                    );
                }

            } else if (direction === 'TO_MEMBER') {
                const corpShipRow = await conn.query(
                    `SELECT stock FROM ${marketTable} WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ? AND corporation_uid = ? LIMIT 1 FOR UPDATE`,
                    [corpStationId, itCode, founderUid, corpUid]
                );
                const corpStock = corpShipRow.length > 0 ? Number(corpShipRow[0].stock) : 0;
                if (corpStock < qty) {
                    await conn.rollback();
                    return res.status(400).json({
                        status: 'erro',
                        mensagem: `Quantidade insuficiente de naves na corporação (disponível: ${corpStock}).`
                    });
                }

                if (corpStock - qty <= 0) {
                    await conn.query(
                        `DELETE FROM ${marketTable} WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ? AND corporation_uid = ?`,
                        [corpStationId, itCode, founderUid, corpUid]
                    );
                } else {
                    await conn.query(
                        `UPDATE ${marketTable} SET stock = stock - ? WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ? AND corporation_uid = ?`,
                        [qty, corpStationId, itCode, founderUid, corpUid]
                    );
                }

                // Cria a(s) nave(s) no hangar do membro
                for (let i = 0; i < qty; i++) {
                    await conn.query(
                        `INSERT INTO vessels (pilot_uid, item_code, selected, engine, sensors, life_support, inertial_damper, integrity, orbit, station)
                         VALUES (?, ?, 'n', 100, 100, 100, 100, 100, ?, ?)`,
                        [memberUid, itCode, memberOrbitId, memberStationId]
                    );
                }
            }

        } else {
            // ==========================================
            // TRANSFERÊNCIA DE ITENS / COMPONENTES (1 a 5)
            // ==========================================
            let contRows = await conn.query(
                "SELECT container_uid, max_volume, current_volume FROM containers WHERE owner = ? AND storage = ? AND type = 'hangar' LIMIT 1 FOR UPDATE",
                [memberUid, memberStationId]
            );
            let memberContainerUid;
            if (contRows.length === 0) {
                const fallbackCont = await conn.query(
                    "SELECT container_uid FROM containers WHERE owner = ? AND type = 'hangar' ORDER BY current_volume DESC LIMIT 1 FOR UPDATE",
                    [memberUid]
                );
                if (fallbackCont.length > 0) {
                    memberContainerUid = Number(fallbackCont[0].container_uid);
                } else {
                    const insCont = await conn.query(
                        "INSERT INTO containers (owner, storage, type, max_volume, current_volume, protected) VALUES (?, ?, 'hangar', 50000, 0, 'y')",
                        [memberUid, memberStationId]
                    );
                    memberContainerUid = Number(insCont.insertId);
                }
            } else {
                memberContainerUid = Number(contRows[0].container_uid);
            }

            if (direction === 'TO_CORPORATION') {
                const slotRows = await conn.query(
                    "SELECT slot, amount FROM container_slots WHERE container_uid = ? AND item_code = ? ORDER BY slot ASC FOR UPDATE",
                    [memberContainerUid, itCode]
                );
                const totalAvail = slotRows.reduce((acc, s) => acc + Number(s.amount), 0);
                if (totalAvail < qty) {
                    await conn.rollback();
                    return res.status(400).json({
                        status: 'erro',
                        mensagem: `Quantidade insuficiente no armazém do piloto (disponível: ${totalAvail}).`
                    });
                }

                let rem = qty;
                for (const s of slotRows) {
                    if (rem <= 0) break;
                    const slotAmt = Number(s.amount);
                    if (slotAmt <= rem) {
                        await conn.query("DELETE FROM container_slots WHERE container_uid = ? AND slot = ?", [memberContainerUid, s.slot]);
                        rem -= slotAmt;
                    } else {
                        await conn.query("UPDATE container_slots SET amount = amount - ? WHERE container_uid = ? AND slot = ?", [rem, memberContainerUid, s.slot]);
                        rem = 0;
                    }
                }

                const corpItemRow = await conn.query(
                    `SELECT stock FROM ${marketTable} WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ? LIMIT 1 FOR UPDATE`,
                    [corpStationId, itCode, founderUid]
                );

                if (corpItemRow.length > 0) {
                    await conn.query(
                        `UPDATE ${marketTable} SET stock = stock + ?, corporation_uid = ? WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ?`,
                        [qty, corpUid, corpStationId, itCode, founderUid]
                    );
                } else {
                    await conn.query(
                        `INSERT INTO ${marketTable} (market_uid, item_code, owner_pilot_uid, corporation_uid, stock, ideal_stock, selling_price, buying_price, base_price)
                         VALUES (?, ?, ?, ?, ?, 100, 0, 0, 0)
                         ON DUPLICATE KEY UPDATE stock = stock + VALUES(stock), corporation_uid = VALUES(corporation_uid)`,
                        [corpStationId, itCode, founderUid, corpUid, qty]
                    );
                }

            } else if (direction === 'TO_MEMBER') {
                const corpItemRow = await conn.query(
                    `SELECT stock FROM ${marketTable} WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ? AND corporation_uid = ? LIMIT 1 FOR UPDATE`,
                    [corpStationId, itCode, founderUid, corpUid]
                );
                const corpStock = corpItemRow.length > 0 ? Number(corpItemRow[0].stock) : 0;
                if (corpStock < qty) {
                    await conn.rollback();
                    return res.status(400).json({
                        status: 'erro',
                        mensagem: `Quantidade insuficiente na área de carga da corporação (disponível: ${corpStock}).`
                    });
                }

                if (corpStock - qty <= 0) {
                    await conn.query(
                        `DELETE FROM ${marketTable} WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ? AND corporation_uid = ?`,
                        [corpStationId, itCode, founderUid, corpUid]
                    );
                } else {
                    await conn.query(
                        `UPDATE ${marketTable} SET stock = stock - ? WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ? AND corporation_uid = ?`,
                        [qty, corpStationId, itCode, founderUid, corpUid]
                    );
                }

                const existingSlot = await conn.query(
                    "SELECT slot FROM container_slots WHERE container_uid = ? AND item_code = ? LIMIT 1 FOR UPDATE",
                    [memberContainerUid, itCode]
                );
                if (existingSlot.length > 0) {
                    await conn.query(
                        "UPDATE container_slots SET amount = amount + ? WHERE container_uid = ? AND slot = ?",
                        [qty, memberContainerUid, existingSlot[0].slot]
                    );
                } else {
                    const maxSlotRow = await conn.query(
                        "SELECT COALESCE(MAX(slot), 0) AS max_slot FROM container_slots WHERE container_uid = ?",
                        [memberContainerUid]
                    );
                    const nextSlot = Number(maxSlotRow[0].max_slot || 0) + 1;
                    await conn.query(
                        "INSERT INTO container_slots (container_uid, slot, item_code, amount) VALUES (?, ?, ?, ?)",
                        [memberContainerUid, nextSlot, itCode, qty]
                    );
                }
            }
        }

        // Registra transação no histórico
        await conn.query(
            `INSERT INTO corporation_item_transactions 
                (corporation_uid, pilot_uid, operator_pilot_uid, item_code, item_name, item_type, quantity, direction, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [corpUid, memberUid, operatorUid, itCode, itemName, itemType, qty, direction]
        );

        await conn.commit();

        return res.json({
            status: 'sucesso',
            mensagem: direction === 'TO_CORPORATION'
                ? `${isShip ? 'Espaçonave' : 'Item'} ${itemName} (x${qty}) doado para a Corporação!`
                : `${isShip ? 'Espaçonave' : 'Item'} ${itemName} (x${qty}) transferido para o membro!`
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[transferCorporationItem Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Consulta o histórico de movimentações de itens da corporação
 */
const getCorporationItemTransactions = async (req, res) => {
    const corpUid = req.params.corpUid;
    const callerPilotUid = req.query.caller_pilot_uid || req.query.pilot_uid;

    if (!corpUid) return res.status(400).json({ status: 'erro', mensagem: 'corpUid é obrigatório.' });

    let conn;
    try {
        conn = await db.getConnection();
        await ensureCorporationItemTransactionsTable(conn);

        let isLeaderOrOfficer = false;
        if (callerPilotUid) {
            const roleRows = await conn.query(
                `SELECT cm.role, c.founder_pilot_uid 
                 FROM corporation_members cm 
                 INNER JOIN corporations c ON c.corporation_uid = cm.corporation_uid
                 WHERE cm.corporation_uid = ? AND cm.pilot_uid = ? LIMIT 1`,
                [corpUid, callerPilotUid]
            );
            if (roleRows.length > 0) {
                const r = roleRows[0];
                if (r.role === 'leader' || r.role === 'officer' || Number(r.founder_pilot_uid) === Number(callerPilotUid)) {
                    isLeaderOrOfficer = true;
                }
            }
        }

        let whereClause = "cit.corporation_uid = ?";
        const params = [corpUid];

        if (!isLeaderOrOfficer && callerPilotUid) {
            whereClause += " AND (cit.pilot_uid = ? OR cit.operator_pilot_uid = ?)";
            params.push(callerPilotUid, callerPilotUid);
        }

        const rows = await conn.query(
            `SELECT 
                cit.transaction_uid,
                cit.corporation_uid,
                cit.pilot_uid,
                COALESCE(p_target.pilot, 'Piloto Desconhecido') AS pilot_name,
                cit.operator_pilot_uid,
                COALESCE(p_op.pilot, 'Operador') AS operator_name,
                cit.item_code,
                cit.item_name,
                cit.item_type,
                cit.quantity,
                cit.direction,
                cit.created_at,
                i.image
             FROM corporation_item_transactions cit
             LEFT JOIN pilots p_target ON p_target.pilot_uid = cit.pilot_uid
             LEFT JOIN pilots p_op ON p_op.pilot_uid = cit.operator_pilot_uid
             LEFT JOIN items i ON i.item_code = cit.item_code
             WHERE ${whereClause}
             ORDER BY cit.transaction_uid DESC
             LIMIT 100`,
            params
        );

        const transactions = rows.map(r => {
            let img = r.image || null;
            if (img && typeof img === 'string') {
                if (img.toLowerCase().endsWith('.svg')) {
                    img = img.replace(/\.svg$/i, '.png');
                }
                if (!img.startsWith('http') && !img.startsWith('/')) {
                    if (Number(r.item_type) === 6) {
                        img = `/hologramas/${img}`;
                    } else {
                        img = `/items/${img}`;
                    }
                }
            }
            return {
                transaction_uid: Number(r.transaction_uid),
                corporation_uid: Number(r.corporation_uid),
                pilot_uid: Number(r.pilot_uid),
                pilot_name: r.pilot_name,
                operator_pilot_uid: Number(r.operator_pilot_uid),
                operator_name: r.operator_name,
                item_code: Number(r.item_code),
                item_name: r.item_name,
                item_type: Number(r.item_type),
                quantity: Number(r.quantity),
                direction: r.direction,
                created_at: r.created_at,
                image_url: img
            };
        });

        return res.json({ status: 'sucesso', data: transactions });
    } catch (err) {
        console.error('[getCorporationItemTransactions Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
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
    removeCorporationMember,
    getCorporationItems,
    getCorporationMemberHangar,
    transferCorporationItem,
    getCorporationItemTransactions
};

