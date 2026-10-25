const db = require('../config/database');

// Busca a lista de canais principais (message_channels)
const getMessageChannels = async (req, res) => {
    let conn;
    try {
        conn = await db.getConnection();
        const rows = await conn.query('SELECT uid, description FROM message_channels ORDER BY uid ASC');
        const dataList = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        return res.json(dataList);
    } catch (error) {
        console.error('Erro ao buscar canais de mensagens:', error);
        return res.status(500).json({ status: 'erro', mensagem: 'Erro interno ao carregar os canais de mensagens.' });
    } finally {
        if (conn) conn.release();
    }
};

// Busca as coalizões/facções da tabela factions
const getFactions = async (req, res) => {
    let conn;
    try {
        conn = await db.getConnection();
        const rows = await conn.query('SELECT faction_uid, name FROM factions ORDER BY faction_uid ASC');
        const dataList = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        return res.json(dataList);
    } catch (error) {
        console.error('Erro ao buscar facções:', error);
        return res.status(500).json({ status: 'erro', mensagem: 'Erro interno ao carregar facções.' });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Busca genérica de membros/subcanais para um canal específico
 * Suporta: 'sector', 'corporation', 'team', 'squad', 'contact', 'support'
 */
const getChannelMembers = async (req, res) => {
    const { channelType, pilotUid } = req.params;
    let conn;

    try {
        conn = await db.getConnection();

        // -------------------------------------------------------------
        // 1. CANAL DE CORPORAÇÃO
        // -------------------------------------------------------------
        if (channelType === 'corporation') {
            const corpRows = await conn.query(
                `SELECT cm.corporation_uid, c.name AS corporation_name 
                 FROM corporation_members cm
                 INNER JOIN corporations c ON cm.corporation_uid = c.corporation_uid
                 WHERE cm.pilot_uid = ?`,
                [pilotUid]
            );
            const corpList = Array.isArray(corpRows) && Array.isArray(corpRows[0]) ? corpRows[0] : corpRows;

            if (corpList.length === 0) {
                return res.json({
                    channel_label: 'CORPORAÇÃO: Sem Corporação',
                    channel_uid: null,
                    pilots: []
                });
            }

            const corpUid = corpList[0].corporation_uid;
            const corpName = corpList[0].corporation_name || 'Corporação';

            const membersRows = await conn.query(
                `SELECT p.pilot_uid, p.pilot, p.orbit, p.sector, p.station, p.docked
                 FROM corporation_members cm
                 INNER JOIN pilots p ON cm.pilot_uid = p.pilot_uid
                 WHERE cm.corporation_uid = ? AND cm.pilot_uid != ?`,
                [corpUid, pilotUid]
            );
            const membersList = Array.isArray(membersRows) && Array.isArray(membersRows[0]) ? membersRows[0] : membersRows;

            return res.json({
                channel_label: `CORPORAÇÃO: ${corpName}`,
                channel_uid: corpUid,
                pilots: membersList
            });
        }

        // -------------------------------------------------------------
        // 2. CANAL DE SETOR (SECTOR)
        // -------------------------------------------------------------
        if (channelType === 'sector') {
            const pilotRows = await conn.query(
                `SELECT sector, orbit FROM pilots WHERE pilot_uid = ?`,
                [pilotUid]
            );
            const pilotData = Array.isArray(pilotRows) && Array.isArray(pilotRows[0]) ? pilotRows[0] : pilotRows;

            if (pilotData.length === 0) {
                return res.json({
                    channel_label: 'SETOR: DESCONHECIDO',
                    channel_uid: 2,
                    pilots: []
                });
            }

            const sectorUid = pilotData[0].sector;

            // Busca o nome do setor na tabela 'sectors' (colunas 'id' e 'name')
            const sectorRows = await conn.query(
                `SELECT name FROM sectors WHERE id = ?`,
                [sectorUid]
            );
            const sectorData = Array.isArray(sectorRows) && Array.isArray(sectorRows[0]) ? sectorRows[0] : sectorRows;
            const sectorName = sectorData.length > 0 ? sectorData[0].name.toUpperCase() : `SETOR #${sectorUid}`;

            // Busca outros pilotos no mesmo setor (exceto o próprio operador)
            const membersRows = await conn.query(
                `SELECT pilot_uid, pilot, orbit, sector, station, docked
                 FROM pilots
                 WHERE sector = ? AND pilot_uid != ?`,
                [sectorUid, pilotUid]
            );
            const membersList = Array.isArray(membersRows) && Array.isArray(membersRows[0]) ? membersRows[0] : membersRows;

            return res.json({
                channel_label: `SETOR: ${sectorName}`,
                channel_uid: sectorUid,
                pilots: membersList
            });
        }

        // -------------------------------------------------------------
        // 3. CANAL DE EQUIPE (TEAM) - Tabela corporation_teams e team_members
        // -------------------------------------------------------------
        if (channelType === 'team') {
            const teamRows = await conn.query(
                `SELECT tm.team_uid, ct.description AS team_name 
                 FROM team_members tm
                 LEFT JOIN corporation_teams ct ON tm.team_uid = ct.team_uid
                 WHERE tm.pilot_uid = ?`,
                [pilotUid]
            );
            const teamList = Array.isArray(teamRows) && Array.isArray(teamRows[0]) ? teamRows[0] : teamRows;

            if (teamList.length === 0) {
                return res.json({
                    channel_label: 'EQUIPE: Sem Equipe',
                    channel_uid: 4,
                    pilots: []
                });
            }

            const teamUid = teamList[0].team_uid;
            const teamName = teamList[0].team_name || `Eq. #${teamUid}`;

            const membersRows = await conn.query(
                `SELECT p.pilot_uid, p.pilot, p.orbit, p.sector, p.station, p.docked
                 FROM team_members tm
                 INNER JOIN pilots p ON tm.pilot_uid = p.pilot_uid
                 WHERE tm.team_uid = ? AND tm.pilot_uid != ?`,
                [teamUid, pilotUid]
            );
            const membersList = Array.isArray(membersRows) && Array.isArray(membersRows[0]) ? membersRows[0] : membersRows;

            return res.json({
                channel_label: `EQUIPE: ${teamName}`,
                channel_uid: teamUid,
                pilots: membersList
            });
        }

        // -------------------------------------------------------------
        // 4. CANAL DE ESQUADRILHA (SQUAD) - Tabela squads
        // -------------------------------------------------------------
        if (channelType === 'squad') {
            const squadRows = await conn.query(
                'SELECT squad_uid FROM squads WHERE pilot_uid = ?',
                [pilotUid]
            );
            const squadList = Array.isArray(squadRows) && Array.isArray(squadRows[0]) ? squadRows[0] : squadRows;

            if (squadList.length === 0) {
                return res.json({
                    channel_label: 'ESQUADRILHA: Sem Esquadrilha',
                    channel_uid: 5,
                    pilots: []
                });
            }

            const squadUid = squadList[0].squad_uid;

            const membersRows = await conn.query(
                `SELECT p.pilot_uid, p.pilot, p.orbit, p.sector, p.station, p.docked
                 FROM squads s
                 INNER JOIN pilots p ON s.pilot_uid = p.pilot_uid
                 WHERE s.squad_uid = ? AND s.pilot_uid != ?`,
                [squadUid, pilotUid]
            );
            const membersList = Array.isArray(membersRows) && Array.isArray(membersRows[0]) ? membersRows[0] : membersRows;

            return res.json({
                channel_label: `ESQUADRILHA: #${squadUid}`,
                channel_uid: squadUid,
                pilots: membersList
            });
        }

        // -------------------------------------------------------------
        // 5. CANAL DE CONTATOS (CONTACTS) - Tabela pilot_contacts
        // -------------------------------------------------------------
        if (channelType === 'contact') {
            const contactsRows = await conn.query(
                `SELECT p.pilot_uid, p.pilot, p.orbit, p.sector, p.station, p.docked
                 FROM pilot_contacts pc
                 INNER JOIN pilots p ON pc.contact_uid = p.pilot_uid
                 WHERE pc.pilot_uid = ?`,
                [pilotUid]
            );
            const contactsList = Array.isArray(contactsRows) && Array.isArray(contactsRows[0]) ? contactsRows[0] : contactsRows;

            return res.json({
                channel_label: 'CONTATOS:',
                channel_uid: 6,
                pilots: contactsList
            });
        }

        // -------------------------------------------------------------
        // 6. CANAL DE SUPORTE (SUPPORT) - Tabela suport
        // -------------------------------------------------------------
        if (channelType === 'support') {
            const supportRows = await conn.query(
                `SELECT uid_subchannel AS pilot_uid, description AS pilot, 0 AS orbit, '' AS sector, '' AS station, 0 AS docked
                 FROM suport
                 WHERE uid_channel = 7`,
                []
            );
            const supportList = Array.isArray(supportRows) && Array.isArray(supportRows[0]) ? supportRows[0] : supportRows;

            return res.json({
                channel_label: 'SUPORTE:',
                channel_uid: 7,
                pilots: supportList
            });
        }

        return res.status(400).json({ error: `Tipo de canal '${channelType}' inválido ou em desenvolvimento.` });

    } catch (err) {
        console.error(`Erro ao buscar membros do canal [${channelType}]:`, err);
        return res.status(500).json({ error: 'Falha interna no servidor.' });
    } finally {
        if (conn) conn.release();
    }
};

// Busca mensagens de um canal, subcanal e destinatário específico
const getFactionMessages = async (req, res) => {
    const { channelUid, subchannelUid } = req.params;
    const { destinationUid, type } = req.query;
    
    if (!destinationUid || destinationUid === 'null' || destinationUid === 'undefined') {
        return res.json([]);
    }
    
    let conn;
    try {
        conn = await db.getConnection();
        
        let queryParams = [channelUid, subchannelUid, destinationUid];
        let typeCondition = '';

        // Se o query param 'type' for enviado explicitamente, utiliza-o
        if (type !== undefined && type !== null && type !== '') {
            typeCondition = ' AND m.type = ?';
            queryParams.push(parseInt(type));
        }
        
        let query = `
            SELECT 
                m.date_time,
                m.text,
                m.is_read,
                m.type,
                a.account AS sender_account,
                a.name AS sender_name
            FROM messages m
            LEFT JOIN accounts a ON m.uid_origin = a.uid
            WHERE m.uid_channel = ? AND m.uid_subchannel = ? AND m.uid_destination = ?${typeCondition}
            ORDER BY m.date_time ASC
        `;
        
        const rows = await conn.query(query, queryParams);
        const dataList = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        return res.json(dataList);
    } catch (error) {
        console.error('Erro ao buscar mensagens:', error);
        return res.status(500).json({ status: 'erro', mensagem: 'Erro interno ao carregar mensagens.' });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Transmissão Genérica de Mensagens (Broadcast / Direta)
 * Grava a mensagem no banco para os membros do grupo ou contato e notifica em tempo real
 */
const sendChannelBroadcastMessage = async (req, res) => {
    const { channel_type, channel_id, subchannel_id, sender_id, content, notification_type } = req.body;

    if (!sender_id || !content) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        let targetPilots = [];
        let finalChannelUid = channel_id;
        let finalSubchannelUid = subchannel_id;
        let messageType = 0; // 0 = Broadcast por padrão

        // -------------------------------------------------------------
        // 1. TRANSMISSÃO PARA A CORPORAÇÃO
        // -------------------------------------------------------------
        if (channel_type === 'corporation') {
            const corpRows = await conn.query(
                'SELECT corporation_uid FROM corporation_members WHERE pilot_uid = ?',
                [sender_id]
            );
            const corpList = Array.isArray(corpRows) && Array.isArray(corpRows[0]) ? corpRows[0] : corpRows;

            if (corpList.length === 0) {
                return res.status(400).json({ error: 'Piloto não possui corporação para transmitir.' });
            }

            const corpUid = corpList[0].corporation_uid;
            finalChannelUid = channel_id || 3;
            finalSubchannelUid = subchannel_id || corpUid;

            const membersRows = await conn.query(
                'SELECT pilot_uid FROM corporation_members WHERE corporation_uid = ?',
                [corpUid]
            );
            targetPilots = Array.isArray(membersRows) && Array.isArray(membersRows[0]) ? membersRows[0] : membersRows;

        // -------------------------------------------------------------
        // 2. TRANSMISSÃO PARA O SETOR
        // -------------------------------------------------------------
        } else if (channel_type === 'sector' || !channel_type) {
            const senderRows = await conn.query(
                'SELECT sector FROM pilots WHERE pilot_uid = ?',
                [sender_id]
            );
            const senderList = Array.isArray(senderRows) && Array.isArray(senderRows[0]) ? senderRows[0] : senderRows;

            if (senderList.length === 0) {
                return res.status(404).json({ error: 'Piloto remetente não encontrado.' });
            }

            const currentSector = senderList[0].sector;
            finalChannelUid = channel_id || 2;
            finalSubchannelUid = subchannel_id || currentSector;

            const sectorPilotsRows = await conn.query(
                'SELECT pilot_uid FROM pilots WHERE sector = ?',
                [currentSector]
            );
            targetPilots = Array.isArray(sectorPilotsRows) && Array.isArray(sectorPilotsRows[0]) ? sectorPilotsRows[0] : sectorPilotsRows;

        // -------------------------------------------------------------
        // 3. TRANSMISSÃO PARA EQUIPE (TEAM)
        // -------------------------------------------------------------
        } else if (channel_type === 'team') {
            const teamRows = await conn.query(
                'SELECT team_uid FROM team_members WHERE pilot_uid = ?',
                [sender_id]
            );
            const teamList = Array.isArray(teamRows) && Array.isArray(teamRows[0]) ? teamRows[0] : teamRows;
            if (teamList.length > 0) {
                const teamUid = teamList[0].team_uid;
                finalChannelUid = channel_id || 4;
                finalSubchannelUid = subchannel_id || teamUid;

                const membersRows = await conn.query(
                    'SELECT pilot_uid FROM team_members WHERE team_uid = ?',
                    [teamUid]
                );
                targetPilots = Array.isArray(membersRows) && Array.isArray(membersRows[0]) ? membersRows[0] : membersRows;
            } else {
                targetPilots = [{ pilot_uid: sender_id }];
            }

        // -------------------------------------------------------------
        // 4. TRANSMISSÃO PARA ESQUADRILHA (SQUAD)
        // -------------------------------------------------------------
        } else if (channel_type === 'squad') {
            const squadRows = await conn.query(
                'SELECT squad_uid FROM squads WHERE pilot_uid = ?',
                [sender_id]
            );
            const squadList = Array.isArray(squadRows) && Array.isArray(squadRows[0]) ? squadRows[0] : squadRows;
            if (squadList.length > 0) {
                const squadUid = squadList[0].squad_uid;
                finalChannelUid = channel_id || 5;
                finalSubchannelUid = subchannel_id || squadUid;

                const membersRows = await conn.query(
                    'SELECT pilot_uid FROM squads WHERE squad_uid = ?',
                    [squadUid]
                );
                targetPilots = Array.isArray(membersRows) && Array.isArray(membersRows[0]) ? membersRows[0] : membersRows;
            } else {
                targetPilots = [{ pilot_uid: sender_id }];
            }

        // -------------------------------------------------------------
        // 5. MENSAGEM DIRETA DE CONTATOS (CHAT = 0 ou MENSAGEM/EMAIL = 1)
        // -------------------------------------------------------------
        } else if (channel_type === 'contact') {
            finalChannelUid = channel_id || 6;
            const targetContactUid = parseInt(subchannel_id);

            // Determina se é chat (type 0) ou mensagem/email (type 1)
            let msgType = 0;
            if (req.body.message_type !== undefined && req.body.message_type !== null) {
                msgType = parseInt(req.body.message_type);
            } else if (req.body.type !== undefined && req.body.type !== null) {
                msgType = parseInt(req.body.type);
            } else if (notification_type === 'email') {
                msgType = 1;
            }

            // 1. Grava no banco para o DESTINATÁRIO (uid_subchannel = sender_id para que o destinatário veja na conversa com o remetente)
            await conn.query(
                `INSERT INTO messages (type, date_time, uid_destination, uid_origin, text, uid_channel, uid_subchannel, status, is_read) 
                 VALUES (?, NOW(), ?, ?, ?, ?, ?, 2, 0)`,
                [msgType, targetContactUid, sender_id, content, finalChannelUid, sender_id]
            );

            // 2. Grava a réplica para o REMETENTE (uid_subchannel = targetContactUid para que o remetente veja o que enviou, já como lida)
            if (targetContactUid !== sender_id) {
                await conn.query(
                    `INSERT INTO messages (type, date_time, uid_destination, uid_origin, text, uid_channel, uid_subchannel, status, is_read) 
                     VALUES (?, NOW(), ?, ?, ?, ?, ?, 2, 1)`,
                    [msgType, sender_id, sender_id, content, finalChannelUid, targetContactUid]
                );
            }

            // 3. Notificação WebSocket exclusivamente para o destinatário
            if (req.app.locals.notifyPilots) {
                const eventType = (msgType === 1 || notification_type === 'email') ? 'EMAIL_NOTIFICATION' : 'CHAT_NOTIFICATION';

                req.app.locals.notifyPilots([targetContactUid], {
                    type: eventType,
                    data: {
                        channel_uid: finalChannelUid,
                        subchannel_uid: sender_id,
                        sender_uid: sender_id,
                        message_text: content,
                        timestamp: new Date().toISOString()
                    }
                });
            }

            return res.status(201).json({ status: 'sucesso', mensagem: 'Mensagem enviada com sucesso!' });

        // -------------------------------------------------------------
        // 5.1. CANAL DE SUPORTE
        // -------------------------------------------------------------
        } else if (channel_type === 'support') {
            finalChannelUid = channel_id || 7;
            finalSubchannelUid = subchannel_id || 1;
            targetPilots = [{ pilot_uid: sender_id }];
            messageType = (req.body.message_type !== undefined) ? parseInt(req.body.message_type) : 0;
        }

        // -------------------------------------------------------------
        // 6. GRAVAÇÃO DAS MENSAGENS NO BANCO DE DADOS
        // -------------------------------------------------------------
        for (const pilot of targetPilots) {
            await conn.query(
                `INSERT INTO messages (type, date_time, uid_destination, uid_origin, text, uid_channel, uid_subchannel, status, is_read) 
                 VALUES (?, NOW(), ?, ?, ?, ?, ?, 2, 0)`,
                [messageType, pilot.pilot_uid, sender_id, content, finalChannelUid, finalSubchannelUid]
            );
        }

        // -------------------------------------------------------------
        // 7. DISPARO DO WEBSOCKET EM TEMPO REAL (CHAT vs EMAIL)
        // -------------------------------------------------------------
        if (req.app.locals.notifyPilots) {
            const recipientUids = targetPilots.map(p => p.pilot_uid);
            
            // Define dinamicamente o tipo de evento (CHAT_NOTIFICATION por padrão, ou EMAIL_NOTIFICATION se especificado)
            const eventType = (notification_type === 'email') ? 'EMAIL_NOTIFICATION' : 'CHAT_NOTIFICATION';

            req.app.locals.notifyPilots(recipientUids, {
                type: eventType,
                data: {
                    channel_uid: finalChannelUid,
                    subchannel_uid: finalSubchannelUid,
                    sender_uid: sender_id,
                    message_text: content,
                    timestamp: new Date().toISOString()
                }
            });
        }

        return res.status(201).json({ status: 'sucesso', mensagem: 'Mensagem enviada com sucesso!' });
    } catch (err) {
        console.error('Erro ao transmitir mensagem no canal:', err);
        return res.status(500).json({ error: 'Erro interno ao processar transmissão.' });
    } finally {
        if (conn) conn.release();
    }
};

// Adiciona um piloto aos contatos
const addContact = async (req, res) => {
    const { pilot_uid, contact_uid } = req.body;

    if (!pilot_uid || !contact_uid) {
        return res.status(400).json({ error: 'Parâmetros pilot_uid e contact_uid são obrigatórios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        
        // Verifica se já existe para evitar duplicata
        const existing = await conn.query(
            'SELECT * FROM pilot_contacts WHERE pilot_uid = ? AND contact_uid = ?',
            [pilot_uid, contact_uid]
        );
        const existingList = Array.isArray(existing) && Array.isArray(existing[0]) ? existing[0] : existing;

        if (existingList.length > 0) {
            return res.status(400).json({ error: 'Este contato já está na sua lista.' });
        }

        await conn.query(
            'INSERT INTO pilot_contacts (pilot_uid, contact_uid) VALUES (?, ?)',
            [pilot_uid, contact_uid]
        );

        return res.status(201).json({ status: 'sucesso', mensagem: 'Contato adicionado com sucesso!' });
    } catch (error) {
        console.error('Erro ao adicionar contato:', error);
        return res.status(500).json({ error: 'Erro interno ao adicionar contato.' });
    } finally {
        if (conn) conn.release();
    }
};

// Remove um piloto dos contatos
const removeContact = async (req, res) => {
    const { pilotUid, contactUid } = req.params;

    if (!pilotUid || !contactUid) {
        return res.status(400).json({ error: 'Parâmetros pilotUid e contactUid são obrigatórios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        
        await conn.query(
            'DELETE FROM pilot_contacts WHERE pilot_uid = ? AND contact_uid = ?',
            [pilotUid, contactUid]
        );

        return res.json({ status: 'sucesso', mensagem: 'Contato removido com sucesso!' });
    } catch (error) {
        console.error('Erro ao remover contato:', error);
        return res.status(500).json({ error: 'Erro interno ao remover contato.' });
    } finally {
        if (conn) conn.release();
    }
};

// Busca o setor atual do piloto
const getPilotSector = async (req, res) => {
    const { pilotUid } = req.params;
    let conn;
    try {
        conn = await db.getConnection();
        const rows = await conn.query('SELECT sector FROM pilots WHERE pilot_uid = ?', [pilotUid]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        if (list.length > 0) {
            return res.json({ status: 'sucesso', sectorUid: list[0].sector });
        }
        return res.status(404).json({ error: 'Piloto não encontrado' });
    } catch (error) {
        console.error('Erro ao buscar setor do piloto:', error);
        return res.status(500).json({ error: 'Erro interno ao buscar setor.' });
    } finally {
        if (conn) conn.release();
    }
};

// Marca as mensagens como lidas (is_read = 1) para um piloto em um canal/subcanal
const markMessagesAsRead = async (req, res) => {
    const { channelUid, subchannelUid } = req.params;
    const { destinationUid, type } = req.query;

    if (!destinationUid) {
        return res.status(400).json({ error: 'destinationUid é obrigatório.' });
    }

    let conn;
    try {
        conn = await db.getConnection();

        let query = `
            UPDATE messages 
            SET is_read = 1 
            WHERE uid_channel = ? AND uid_subchannel = ? AND uid_destination = ? AND is_read = 0
        `;
        let queryParams = [channelUid, subchannelUid, destinationUid];

        if (type !== undefined && type !== null && type !== '') {
            query += ' AND type = ?';
            queryParams.push(parseInt(type));
        }

        await conn.query(query, queryParams);

        return res.json({ status: 'sucesso', mensagem: 'Mensagens marcadas como lidas.' });
    } catch (error) {
        console.error('Erro ao marcar mensagens como lidas:', error);
        return res.status(500).json({ status: 'erro', mensagem: 'Erro interno ao atualizar mensagens.' });
    } finally {
        if (conn) conn.release();
    }
};

// Marca todas as mensagens como lidas (is_read = 1) para um piloto (com filtro opcional por type: 0 = chat, 1 = email)
const markAllMessagesAsRead = async (req, res) => {
    const { destinationUid } = req.params;
    const { type } = req.query;

    if (!destinationUid) {
        return res.status(400).json({ error: 'destinationUid é obrigatório.' });
    }

    let conn;
    try {
        conn = await db.getConnection();

        let query = `
            UPDATE messages 
            SET is_read = 1 
            WHERE uid_destination = ? AND is_read = 0
        `;
        let queryParams = [destinationUid];

        if (type !== undefined && type !== null && type !== '') {
            query += ' AND type = ?';
            queryParams.push(parseInt(type));
        }

        await conn.query(query, queryParams);

        return res.json({ status: 'sucesso', mensagem: 'Todas as mensagens foram marcadas como lidas.' });
    } catch (error) {
        console.error('Erro ao marcar todas as mensagens como lidas:', error);
        return res.status(500).json({ status: 'erro', mensagem: 'Erro interno ao atualizar mensagens.' });
    } finally {
        if (conn) conn.release();
    }
};

// Verifica se existem mensagens não lidas para o piloto em qualquer canal (uid_destination)
const checkUnreadStatus = async (req, res) => {
    const { pilotUid } = req.params;

    if (!pilotUid) {
        return res.status(400).json({ error: 'pilotUid é obrigatório.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        const rows = await conn.query(
            'SELECT type, COUNT(*) as unread_count FROM messages WHERE uid_destination = ? AND is_read = 0 GROUP BY type',
            [pilotUid]
        );
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        console.log(`[Unread Status] Piloto ${pilotUid} - Linhas retornadas do banco:`, list);

        let hasChatUnread = false;
        let hasEmailUnread = false;

        for (const item of list) {
            const itemType = parseInt(item.type, 10);
            const count = Number(item.unread_count);
            if (itemType === 0 && count > 0) hasChatUnread = true;
            if (itemType === 1 && count > 0) hasEmailUnread = true;
        }

        console.log(`[Unread Status] Piloto ${pilotUid} - Resultado final: Chat=${hasChatUnread}, Email=${hasEmailUnread}`);

        return res.json({
            status: 'sucesso',
            has_unread_chat: hasChatUnread,
            has_unread_email: hasEmailUnread
        });
    } catch (error) {
        console.error('Erro ao verificar status de mensagens não lidas:', error);
        return res.status(500).json({ status: 'erro', mensagem: 'Erro interno.' });
    } finally {
        if (conn) conn.release();
    }
};

module.exports = {
    getMessageChannels,
    getFactions,
    getChannelMembers,
    getFactionMessages,
    sendChannelBroadcastMessage,
    getPilotSector,
    addContact,
    removeContact,
    markMessagesAsRead,
    markAllMessagesAsRead,
    checkUnreadStatus // <-- Função adicionada e exportada com sucesso
};