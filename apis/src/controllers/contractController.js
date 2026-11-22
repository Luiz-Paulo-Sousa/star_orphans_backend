const db = require('../config/database');

/**
 * Helper para formatar o objeto do contrato para o frontend
 */
const formatContract = (r) => {
    return {
        contract_uid: Number(r.contract_uid),
        issuer_type: r.isuser_type || 'system',
        issuer_uid: Number(r.isuser_uid || 0),
        issuer_name: r.issuer_name || (r.isuser_type === 'system' ? 'Governança de Kali' : 'Piloto Desconhecido'),
        target_career: r.target_career || 'general',
        min_career_tier: Number(r.min_career_tier || 0),
        contract_type: r.contract_type || 'bounty',
        title: r.title,
        description: r.description,
        origin_station_id: r.origin_station_id != null ? Number(r.origin_station_id) : null,
        origin_station_name: r.origin_station_name || null,
        destination_station_id: r.destination_station_id != null ? Number(r.destination_station_id) : null,
        destination_station_name: r.destination_station_name || null,
        target_orbit: r.target_orbit != null ? Number(r.target_orbit) : null,
        reward_credits: Number(r.reward_credits || 0),
        reward_reputation: Number(r.reward_reputation || 0),
        collateral_credits: Number(r.collateral_credits || 0),
        target_item_code: r.target_item_code != null ? Number(r.target_item_code) : null,
        target_item_name: r.target_item_name || null,
        target_amount: Number(r.target_amount || 1),
        duration_seconds: Number(r.duration_seconds || 86400),
        uncancellable: r.uncancellable || 'n',
        status: r.status || 'available',
        created_at: r.created_at,
        expires_at: r.expires_at,
        // Campos de aceitação (caso esteja ativo)
        acceptance_id: r.acceptance_id != null ? Number(r.acceptance_id) : undefined,
        accepted_at: r.accepted_at || undefined,
        deadline_at: r.deadline_at || undefined,
        current_progress: r.current_progress != null ? Number(r.current_progress) : undefined,
        target_progress: r.target_progress != null ? Number(r.target_progress) : Number(r.target_amount || 1),
    };
};

/**
 * 1. Lista contratos disponíveis para contratação
 */
const getAvailableContracts = async (req, res) => {
    const pilotUid = req.query.pilot_uid;

    let conn;
    try {
        conn = await db.getConnection();

        const rows = await conn.query(
            `SELECT 
                c.*,
                st_orig.name AS origin_station_name,
                st_dest.name AS destination_station_name,
                i.name AS target_item_name,
                CASE 
                    WHEN c.isuser_type = 'system' THEN 'Governança de Kali'
                    WHEN c.isuser_type = 'corporation' THEN COALESCE(corp.name, 'Corporação')
                    WHEN c.isuser_type = 'pilot' THEN COALESCE(p.pilot, 'Comandante')
                    ELSE 'Sistema'
                END AS issuer_name
             FROM contracts c
             LEFT JOIN orbit_stations st_orig ON st_orig.id = c.origin_station_id
             LEFT JOIN orbit_stations st_dest ON st_dest.id = c.destination_station_id
             LEFT JOIN items i ON i.item_code = c.target_item_code
             LEFT JOIN pilots p ON p.pilot_uid = c.isuser_uid AND c.isuser_type = 'pilot'
             LEFT JOIN corporations corp ON corp.corporation_uid = c.isuser_uid AND c.isuser_type = 'corporation'
             WHERE c.status = 'available'
             ORDER BY c.contract_uid DESC
             LIMIT 100`
        );

        const list = rows.map(formatContract);
        return res.json(list);
    } catch (err) {
        console.error('[getAvailableContracts Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * 2. Lista contratos ativos aceitos pelo piloto
 */
const getActiveContracts = async (req, res) => {
    const { pilotUid } = req.params;
    if (!pilotUid) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilotUid é obrigatório.' });
    }

    let conn;
    try {
        conn = await db.getConnection();

        const rows = await conn.query(
            `SELECT 
                c.*,
                ca.acceptance_id,
                ca.accepted_at,
                ca.deadline_at,
                ca.current_progress,
                ca.target_progress,
                ca.status AS acceptance_status,
                st_orig.name AS origin_station_name,
                st_dest.name AS destination_station_name,
                i.name AS target_item_name,
                CASE 
                    WHEN c.isuser_type = 'system' THEN 'Governança de Kali'
                    WHEN c.isuser_type = 'corporation' THEN COALESCE(corp.name, 'Corporação')
                    WHEN c.isuser_type = 'pilot' THEN COALESCE(p.pilot, 'Comandante')
                    ELSE 'Sistema'
                END AS issuer_name
             FROM contract_acceptances ca
             INNER JOIN contracts c ON c.contract_uid = ca.contract_uid
             LEFT JOIN orbit_stations st_orig ON st_orig.id = c.origin_station_id
             LEFT JOIN orbit_stations st_dest ON st_dest.id = c.destination_station_id
             LEFT JOIN items i ON i.item_code = c.target_item_code
             LEFT JOIN pilots p ON p.pilot_uid = c.isuser_uid AND c.isuser_type = 'pilot'
             LEFT JOIN corporations corp ON corp.corporation_uid = c.isuser_uid AND c.isuser_type = 'corporation'
             WHERE ca.pilot_uid = ? AND ca.status = 'active'
             ORDER BY ca.acceptance_id DESC`,
            [pilotUid]
        );

        const list = rows.map(formatContract);
        return res.json(list);
    } catch (err) {
        console.error('[getActiveContracts Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * 3. Lista contratos emitidos pelo piloto (Contratante)
 */
const getIssuerContracts = async (req, res) => {
    const { pilotUid } = req.params;
    if (!pilotUid) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilotUid é obrigatório.' });
    }

    let conn;
    try {
        conn = await db.getConnection();

        const rows = await conn.query(
            `SELECT 
                c.*,
                st_orig.name AS origin_station_name,
                st_dest.name AS destination_station_name,
                i.name AS target_item_name,
                COALESCE(p.pilot, 'Você') AS issuer_name
             FROM contracts c
             LEFT JOIN orbit_stations st_orig ON st_orig.id = c.origin_station_id
             LEFT JOIN orbit_stations st_dest ON st_dest.id = c.destination_station_id
             LEFT JOIN items i ON i.item_code = c.target_item_code
             LEFT JOIN pilots p ON p.pilot_uid = c.isuser_uid
             WHERE c.isuser_type = 'pilot' AND c.isuser_uid = ?
             ORDER BY c.contract_uid DESC`,
            [pilotUid]
        );

        const list = rows.map(formatContract);
        return res.json(list);
    } catch (err) {
        console.error('[getIssuerContracts Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * 4. Criação de novo contrato por um piloto (Contratante)
 */
const createContract = async (req, res) => {
    const {
        pilot_uid,
        title,
        description,
        target_career,
        min_career_tier,
        contract_type,
        origin_station_id,
        destination_station_id,
        target_orbit,
        reward_credits,
        reward_reputation,
        collateral_credits,
        target_item_code,
        target_amount,
        duration_seconds,
        uncancellable
    } = req.body;

    if (!pilot_uid || !title) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilot_uid e title são obrigatórios.' });
    }

    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3 || trimmedTitle.length > 60) {
        return res.status(400).json({ status: 'erro', mensagem: 'O título do contrato deve ter entre 3 e 60 caracteres.' });
    }

    const trimmedDesc = (description || '').trim();
    if (!trimmedDesc || trimmedDesc.length > 255) {
        return res.status(400).json({ status: 'erro', mensagem: 'A descrição do contrato deve ter até 255 caracteres.' });
    }

    const reward = Math.max(0, parseInt(reward_credits, 10) || 0);
    const collateral = Math.max(0, parseInt(collateral_credits, 10) || 0);
    const duration = Math.max(600, parseInt(duration_seconds, 10) || 86400); // Mínimo 10 min, padrão 24h

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        // 1. Se houver recompensa em créditos, valida e retém da carteira do contratante
        if (reward > 0) {
            const walletRows = await conn.query(
                "SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1 FOR UPDATE",
                [pilot_uid]
            );
            if (walletRows.length === 0) {
                await conn.rollback();
                return res.status(400).json({ status: 'erro', mensagem: 'Carteira do piloto não encontrada.' });
            }
            const currentCredits = Number(walletRows[0].credits || 0);
            if (currentCredits < reward) {
                await conn.rollback();
                return res.status(400).json({
                    status: 'erro',
                    mensagem: `Saldo insuficiente para cobrir a recompensa do contrato (necessário: ${reward.toLocaleString('pt-BR')} CR, disponível: ${currentCredits.toLocaleString('pt-BR')} CR).`
                });
            }

            // Deduz a recompensa da carteira do contratante
            await conn.query(
                "UPDATE wallets SET credits = credits - ? WHERE wallet_uid = ?",
                [reward, pilot_uid]
            );
        }

        // 2. Insere o contrato na tabela
        const result = await conn.query(
            `INSERT INTO contracts (
                isuser_type,
                isuser_uid,
                target_career,
                min_career_tier,
                contract_type,
                title,
                description,
                origin_station_id,
                destination_station_id,
                target_orbit,
                reward_credits,
                reward_reputation,
                collateral_credits,
                target_item_code,
                target_amount,
                duration_seconds,
                uncancellable,
                status,
                created_at,
                expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))`,
            [
                'pilot',
                pilot_uid,
                target_career || 'general',
                Math.max(0, Math.min(5, parseInt(min_career_tier, 10) || 0)),
                contract_type || 'bounty',
                trimmedTitle,
                trimmedDesc,
                origin_station_id ? parseInt(origin_station_id, 10) : null,
                destination_station_id ? parseInt(destination_station_id, 10) : null,
                target_orbit ? parseInt(target_orbit, 10) : null,
                reward,
                Math.max(0, parseInt(reward_reputation, 10) || 0),
                collateral,
                target_item_code ? parseInt(target_item_code, 10) : null,
                Math.max(1, parseInt(target_amount, 10) || 1),
                duration,
                uncancellable === 'y' ? 'y' : 'n',
                duration
            ]
        );

        const newContractUid = Number(result.insertId);
        await conn.commit();

        // Consulta saldo atualizado do piloto
        const updatedWallet = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1", [pilot_uid]);
        const pilotAfter = updatedWallet.length > 0 ? Number(updatedWallet[0].credits) : 0;

        return res.json({
            status: 'sucesso',
            mensagem: 'Contrato publicado com sucesso no setor!',
            contract_uid: newContractUid,
            pilot_credits: pilotAfter
        });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[createContract Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * 5. Edição de contrato existente (apenas pelo criador enquanto estiver 'available')
 */
const editContract = async (req, res) => {
    const { contractUid } = req.params;
    const {
        pilot_uid,
        title,
        description,
        target_career,
        min_career_tier,
        contract_type,
        origin_station_id,
        destination_station_id,
        target_orbit,
        reward_credits,
        reward_reputation,
        collateral_credits,
        target_item_code,
        target_amount,
        duration_seconds,
        uncancellable
    } = req.body;

    if (!contractUid || !pilot_uid) {
        return res.status(400).json({ status: 'erro', mensagem: 'contractUid e pilot_uid são obrigatórios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const contractRows = await conn.query(
            "SELECT * FROM contracts WHERE contract_uid = ? LIMIT 1 FOR UPDATE",
            [contractUid]
        );
        if (contractRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Contrato não encontrado.' });
        }

        const existing = contractRows[0];
        if (Number(existing.isuser_uid) !== Number(pilot_uid)) {
            await conn.rollback();
            return res.status(403).json({ status: 'erro', mensagem: 'Apenas o contratante criador pode editar este contrato.' });
        }

        if (existing.status !== 'available') {
            await conn.rollback();
            return res.status(400).json({
                status: 'erro',
                mensagem: `Não é possível editar um contrato que está no status '${existing.status}'. Apenas contratos disponíveis podem ser alterados.`
            });
        }

        const oldReward = Number(existing.reward_credits || 0);
        const newReward = Math.max(0, parseInt(reward_credits, 10) || 0);
        const rewardDiff = newReward - oldReward;

        // Se a recompensa mudou, ajusta a carteira do criador
        if (rewardDiff > 0) {
            // Aumentou a recompensa: debita a diferença da carteira
            const walletRows = await conn.query(
                "SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1 FOR UPDATE",
                [pilot_uid]
            );
            const currentCredits = walletRows.length > 0 ? Number(walletRows[0].credits || 0) : 0;
            if (currentCredits < rewardDiff) {
                await conn.rollback();
                return res.status(400).json({
                    status: 'erro',
                    mensagem: `Saldo insuficiente para aumentar a recompensa (necessário mais: ${rewardDiff.toLocaleString('pt-BR')} CR, disponível: ${currentCredits.toLocaleString('pt-BR')} CR).`
                });
            }
            await conn.query("UPDATE wallets SET credits = credits - ? WHERE wallet_uid = ?", [rewardDiff, pilot_uid]);
        } else if (rewardDiff < 0) {
            // Diminuiu a recompensa: estorna a diferença para a carteira
            const refund = Math.abs(rewardDiff);
            await conn.query("UPDATE wallets SET credits = credits + ? WHERE wallet_uid = ?", [refund, pilot_uid]);
        }

        const trimmedTitle = (title || existing.title).trim();
        const trimmedDesc = (description || existing.description).trim();
        const duration = Math.max(600, parseInt(duration_seconds, 10) || Number(existing.duration_seconds || 86400));

        await conn.query(
            `UPDATE contracts SET
                title = ?,
                description = ?,
                target_career = ?,
                min_career_tier = ?,
                contract_type = ?,
                origin_station_id = ?,
                destination_station_id = ?,
                target_orbit = ?,
                reward_credits = ?,
                reward_reputation = ?,
                collateral_credits = ?,
                target_item_code = ?,
                target_amount = ?,
                duration_seconds = ?,
                uncancellable = ?
             WHERE contract_uid = ?`,
            [
                trimmedTitle,
                trimmedDesc,
                target_career || existing.target_career,
                min_career_tier !== undefined ? Math.max(0, Math.min(5, parseInt(min_career_tier, 10))) : existing.min_career_tier,
                contract_type || existing.contract_type,
                origin_station_id !== undefined ? (origin_station_id ? parseInt(origin_station_id, 10) : null) : existing.origin_station_id,
                destination_station_id !== undefined ? (destination_station_id ? parseInt(destination_station_id, 10) : null) : existing.destination_station_id,
                target_orbit !== undefined ? (target_orbit ? parseInt(target_orbit, 10) : null) : existing.target_orbit,
                newReward,
                reward_reputation !== undefined ? Math.max(0, parseInt(reward_reputation, 10)) : existing.reward_reputation,
                collateral_credits !== undefined ? Math.max(0, parseInt(collateral_credits, 10)) : existing.collateral_credits,
                target_item_code !== undefined ? (target_item_code ? parseInt(target_item_code, 10) : null) : existing.target_item_code,
                target_amount !== undefined ? Math.max(1, parseInt(target_amount, 10)) : existing.target_amount,
                duration,
                uncancellable !== undefined ? (uncancellable === 'y' ? 'y' : 'n') : existing.uncancellable,
                contractUid
            ]
        );

        await conn.commit();

        // Consulta saldo atualizado do piloto
        const updatedWallet = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1", [pilot_uid]);
        const pilotAfter = updatedWallet.length > 0 ? Number(updatedWallet[0].credits) : 0;

        return res.json({
            status: 'sucesso',
            mensagem: 'Contrato atualizado com sucesso!',
            pilot_credits: pilotAfter
        });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[editContract Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * 6. Cancelamento de contrato pelo Contratante
 */
const cancelContract = async (req, res) => {
    const { contractUid } = req.params;
    const { pilot_uid } = req.body;

    if (!contractUid || !pilot_uid) {
        return res.status(400).json({ status: 'erro', mensagem: 'contractUid e pilot_uid são obrigatórios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const contractRows = await conn.query(
            "SELECT * FROM contracts WHERE contract_uid = ? LIMIT 1 FOR UPDATE",
            [contractUid]
        );
        if (contractRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Contrato não encontrado.' });
        }

        const existing = contractRows[0];
        if (Number(existing.isuser_uid) !== Number(pilot_uid)) {
            await conn.rollback();
            return res.status(403).json({ status: 'erro', mensagem: 'Apenas o contratante criador pode cancelar este contrato.' });
        }

        if (existing.status === 'cancelled') {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Este contrato já se encontra cancelado.' });
        }

        if (existing.status === 'completed') {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Não é possível cancelar um contrato que já foi concluído.' });
        }

        // Se está em andamento e é incancelável
        if (existing.status === 'in_progress' && existing.uncancellable === 'y') {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Este contrato foi marcado como NÃO CANCELÁVEL durante sua execução!' });
        }

        const rewardToRefund = Number(existing.reward_credits || 0);

        // Estorna a recompensa para a carteira do criador se estava disponível ou em andamento
        if (rewardToRefund > 0) {
            await conn.query(
                "UPDATE wallets SET credits = credits + ? WHERE wallet_uid = ?",
                [rewardToRefund, pilot_uid]
            );
        }

        // Se estava em andamento, encerra as aceitações ativas como 'failed' e devolve eventual caução ao contratado
        if (existing.status === 'in_progress') {
            const activeAcceptances = await conn.query(
                "SELECT * FROM contract_acceptances WHERE contract_uid = ? AND status = 'active' FOR UPDATE",
                [contractUid]
            );
            for (const acc of activeAcceptances) {
                await conn.query(
                    "UPDATE contract_acceptances SET status = 'failed' WHERE acceptance_id = ?",
                    [acc.acceptance_id]
                );
                // Devolve a caução para o piloto contratado
                const collateral = Number(existing.collateral_credits || 0);
                if (collateral > 0) {
                    await conn.query(
                        "UPDATE wallets SET credits = credits + ? WHERE wallet_uid = ?",
                        [collateral, acc.pilot_uid]
                    );
                }
            }
        }

        // Marca contrato como cancelado
        await conn.query("UPDATE contracts SET status = 'cancelled' WHERE contract_uid = ?", [contractUid]);

        await conn.commit();

        const updatedWallet = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1", [pilot_uid]);
        const pilotAfter = updatedWallet.length > 0 ? Number(updatedWallet[0].credits) : 0;

        return res.json({
            status: 'sucesso',
            mensagem: rewardToRefund > 0
                ? `Contrato cancelado com sucesso! Recompensa de ${rewardToRefund.toLocaleString('pt-BR')} CR foi estornada para sua carteira.`
                : 'Contrato cancelado com sucesso!',
            pilot_credits: pilotAfter
        });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[cancelContract Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * 7. Reativação de missão (Contratos concluídos, cancelados ou falhados)
 */
const reactivateContract = async (req, res) => {
    const { contractUid } = req.params;
    const { pilot_uid } = req.body;

    if (!contractUid || !pilot_uid) {
        return res.status(400).json({ status: 'erro', mensagem: 'contractUid e pilot_uid são obrigatórios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const contractRows = await conn.query(
            "SELECT * FROM contracts WHERE contract_uid = ? LIMIT 1 FOR UPDATE",
            [contractUid]
        );
        if (contractRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Contrato não encontrado.' });
        }

        const existing = contractRows[0];
        if (Number(existing.isuser_uid) !== Number(pilot_uid)) {
            await conn.rollback();
            return res.status(403).json({ status: 'erro', mensagem: 'Apenas o contratante criador pode reativar este contrato.' });
        }

        if (existing.status === 'available') {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Este contrato já está ativo e disponível para contratação.' });
        }

        const reward = Number(existing.reward_credits || 0);

        // Valida e debita os créditos da recompensa para colocar o contrato novamente na praça
        if (reward > 0) {
            const walletRows = await conn.query(
                "SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1 FOR UPDATE",
                [pilot_uid]
            );
            const currentCredits = walletRows.length > 0 ? Number(walletRows[0].credits || 0) : 0;
            if (currentCredits < reward) {
                await conn.rollback();
                return res.status(400).json({
                    status: 'erro',
                    mensagem: `Saldo insuficiente para reativar o contrato (necessário: ${reward.toLocaleString('pt-BR')} CR, disponível: ${currentCredits.toLocaleString('pt-BR')} CR).`
                });
            }

            await conn.query("UPDATE wallets SET credits = credits - ? WHERE wallet_uid = ?", [reward, pilot_uid]);
        }

        const duration = Number(existing.duration_seconds || 86400);

        // Reativa o contrato
        await conn.query(
            `UPDATE contracts SET 
                status = 'available',
                created_at = NOW(),
                expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
             WHERE contract_uid = ?`,
            [duration, contractUid]
        );

        await conn.commit();

        const updatedWallet = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1", [pilot_uid]);
        const pilotAfter = updatedWallet.length > 0 ? Number(updatedWallet[0].credits) : 0;

        return res.json({
            status: 'sucesso',
            mensagem: 'Missão reativada com sucesso e colocada à disposição no setor!',
            pilot_credits: pilotAfter
        });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[reactivateContract Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * 8. Clonagem / Duplicação rápida de missão existente
 */
const cloneContract = async (req, res) => {
    const { contractUid } = req.params;
    const { pilot_uid } = req.body;

    if (!contractUid || !pilot_uid) {
        return res.status(400).json({ status: 'erro', mensagem: 'contractUid e pilot_uid são obrigatórios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const contractRows = await conn.query(
            "SELECT * FROM contracts WHERE contract_uid = ? LIMIT 1",
            [contractUid]
        );
        if (contractRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Contrato original não encontrado.' });
        }

        const source = contractRows[0];
        const reward = Number(source.reward_credits || 0);

        // Valida e debita os créditos da recompensa
        if (reward > 0) {
            const walletRows = await conn.query(
                "SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1 FOR UPDATE",
                [pilot_uid]
            );
            const currentCredits = walletRows.length > 0 ? Number(walletRows[0].credits || 0) : 0;
            if (currentCredits < reward) {
                await conn.rollback();
                return res.status(400).json({
                    status: 'erro',
                    mensagem: `Saldo insuficiente para clonar o contrato (necessário: ${reward.toLocaleString('pt-BR')} CR, disponível: ${currentCredits.toLocaleString('pt-BR')} CR).`
                });
            }

            await conn.query("UPDATE wallets SET credits = credits - ? WHERE wallet_uid = ?", [reward, pilot_uid]);
        }

        const duration = Number(source.duration_seconds || 86400);

        const result = await conn.query(
            `INSERT INTO contracts (
                isuser_type,
                isuser_uid,
                target_career,
                min_career_tier,
                contract_type,
                title,
                description,
                origin_station_id,
                destination_station_id,
                target_orbit,
                reward_credits,
                reward_reputation,
                collateral_credits,
                target_item_code,
                target_amount,
                duration_seconds,
                uncancellable,
                status,
                created_at,
                expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))`,
            [
                'pilot',
                pilot_uid,
                source.target_career,
                source.min_career_tier,
                source.contract_type,
                `${source.title} (Clone)`.slice(0, 60),
                source.description,
                source.origin_station_id,
                source.destination_station_id,
                source.target_orbit,
                reward,
                source.reward_reputation,
                source.collateral_credits,
                source.target_item_code,
                source.target_amount,
                duration,
                source.uncancellable,
                duration
            ]
        );

        const newId = Number(result.insertId);
        await conn.commit();

        const updatedWallet = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1", [pilot_uid]);
        const pilotAfter = updatedWallet.length > 0 ? Number(updatedWallet[0].credits) : 0;

        return res.json({
            status: 'sucesso',
            mensagem: 'Contrato clonado com sucesso!',
            contract_uid: newId,
            pilot_credits: pilotAfter
        });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[cloneContract Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * 9. Aceite de contrato por um piloto (Contratado)
 */
const acceptContract = async (req, res) => {
    const { contractUid } = req.params;
    const { pilot_uid } = req.body;

    if (!contractUid || !pilot_uid) {
        return res.status(400).json({ status: 'erro', mensagem: 'contractUid e pilot_uid são obrigatórios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const contractRows = await conn.query(
            "SELECT * FROM contracts WHERE contract_uid = ? LIMIT 1 FOR UPDATE",
            [contractUid]
        );
        if (contractRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Contrato não encontrado.' });
        }

        const contract = contractRows[0];
        if (contract.status !== 'available') {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Este contrato não está mais disponível para aceite.' });
        }

        if (contract.isuser_type === 'pilot' && Number(contract.isuser_uid) === Number(pilot_uid)) {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Você não pode aceitar um contrato criado por você mesmo.' });
        }

        // Verifica se o piloto já possui este contrato ativo
        const alreadyActive = await conn.query(
            "SELECT acceptance_id FROM contract_acceptances WHERE contract_uid = ? AND pilot_uid = ? AND status = 'active' LIMIT 1",
            [contractUid, pilot_uid]
        );
        if (alreadyActive.length > 0) {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Você já possui esta missão ativa.' });
        }

        // Se houver caução exigida, debita da carteira do piloto contratado
        const collateral = Number(contract.collateral_credits || 0);
        if (collateral > 0) {
            const walletRows = await conn.query(
                "SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1 FOR UPDATE",
                [pilot_uid]
            );
            const currentCredits = walletRows.length > 0 ? Number(walletRows[0].credits || 0) : 0;
            if (currentCredits < collateral) {
                await conn.rollback();
                return res.status(400).json({
                    status: 'erro',
                    mensagem: `Saldo insuficiente para cobrir o caução exigido de ${collateral.toLocaleString('pt-BR')} CR (disponível: ${currentCredits.toLocaleString('pt-BR')} CR).`
                });
            }

            await conn.query("UPDATE wallets SET credits = credits - ? WHERE wallet_uid = ?", [collateral, pilot_uid]);
        }

        const duration = Number(contract.duration_seconds || 86400);

        // Cria a aceitação
        const accResult = await conn.query(
            `INSERT INTO contract_acceptances (
                contract_uid,
                pilot_uid,
                accepted_at,
                deadline_at,
                current_progress,
                target_progress,
                status
            ) VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND), 0, ?, 'active')`,
            [
                contractUid,
                pilot_uid,
                duration,
                Number(contract.target_amount || 1)
            ]
        );

        // Marca contrato como em progresso
        await conn.query("UPDATE contracts SET status = 'in_progress' WHERE contract_uid = ?", [contractUid]);

        await conn.commit();

        const updatedWallet = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1", [pilot_uid]);
        const pilotAfter = updatedWallet.length > 0 ? Number(updatedWallet[0].credits) : 0;

        return res.json({
            status: 'sucesso',
            mensagem: 'Missão aceita com sucesso! Verifique na aba "Meus Contratos Ativos".',
            acceptance_id: Number(accResult.insertId),
            pilot_credits: pilotAfter
        });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[acceptContract Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * 10. Entrega / Conclusão da missão ativa (Contratado)
 */
const deliverContract = async (req, res) => {
    const { contractUid } = req.params;
    const { pilot_uid } = req.body;

    if (!contractUid || !pilot_uid) {
        return res.status(400).json({ status: 'erro', mensagem: 'contractUid e pilot_uid são obrigatórios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        // 1. Busca aceitação ativa do piloto
        const accRows = await conn.query(
            "SELECT * FROM contract_acceptances WHERE contract_uid = ? AND pilot_uid = ? AND status = 'active' LIMIT 1 FOR UPDATE",
            [contractUid, pilot_uid]
        );
        if (accRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Nenhuma aceitação ativa desta missão encontrada para este piloto.' });
        }
        const acceptance = accRows[0];

        // 2. Busca dados do contrato
        const contractRows = await conn.query(
            "SELECT * FROM contracts WHERE contract_uid = ? LIMIT 1 FOR UPDATE",
            [contractUid]
        );
        if (contractRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Contrato não encontrado.' });
        }
        const contract = contractRows[0];

        const reward = Number(contract.reward_credits || 0);
        const collateral = Number(contract.collateral_credits || 0);
        const totalPayout = reward + collateral; // Recompensa + devolução do caução

        // 3. Credita a recompensa + caução na carteira do piloto contratado
        if (totalPayout > 0) {
            await conn.query(
                "UPDATE wallets SET credits = credits + ? WHERE wallet_uid = ?",
                [totalPayout, pilot_uid]
            );
        }

        // 4. Marca aceitação como 'completed'
        await conn.query(
            "UPDATE contract_acceptances SET status = 'completed', completed_at = NOW(), current_progress = target_progress WHERE acceptance_id = ?",
            [acceptance.acceptance_id]
        );

        // 5. Marca o contrato como 'completed'
        await conn.query("UPDATE contracts SET status = 'completed' WHERE contract_uid = ?", [contractUid]);

        await conn.commit();

        const updatedWallet = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1", [pilot_uid]);
        const pilotAfter = updatedWallet.length > 0 ? Number(updatedWallet[0].credits) : 0;

        return res.json({
            status: 'sucesso',
            mensagem: `Contrato entregue com sucesso! Recompensa de ${reward.toLocaleString('pt-BR')} CR${collateral > 0 ? ` (+ ${collateral.toLocaleString('pt-BR')} CR de caução)` : ''} creditada na sua carteira.`,
            reward_credits: reward,
            collateral_returned: collateral,
            pilot_credits: pilotAfter
        });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[deliverContract Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * 11. Abandono de missão ativa (Contratado)
 */
const abandonContract = async (req, res) => {
    const { contractUid } = req.params;
    const { pilot_uid } = req.body;

    if (!contractUid || !pilot_uid) {
        return res.status(400).json({ status: 'erro', mensagem: 'contractUid e pilot_uid são obrigatórios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const accRows = await conn.query(
            "SELECT * FROM contract_acceptances WHERE contract_uid = ? AND pilot_uid = ? AND status = 'active' LIMIT 1 FOR UPDATE",
            [contractUid, pilot_uid]
        );
        if (accRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Missão ativa não encontrada.' });
        }
        const acceptance = accRows[0];

        const contractRows = await conn.query(
            "SELECT * FROM contracts WHERE contract_uid = ? LIMIT 1 FOR UPDATE",
            [contractUid]
        );
        if (contractRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Contrato não encontrado.' });
        }
        const contract = contractRows[0];

        if (contract.uncancellable === 'y') {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Este contrato está marcado como NÃO CANCELÁVEL / INABANDONÁVEL!' });
        }

        // Marca aceitação como 'failed'
        await conn.query(
            "UPDATE contract_acceptances SET status = 'failed' WHERE acceptance_id = ?",
            [acceptance.acceptance_id]
        );

        // Libera o contrato novamente para 'available'
        await conn.query("UPDATE contracts SET status = 'available' WHERE contract_uid = ?", [contractUid]);

        await conn.commit();

        const updatedWallet = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1", [pilot_uid]);
        const pilotAfter = updatedWallet.length > 0 ? Number(updatedWallet[0].credits) : 0;

        return res.json({
            status: 'sucesso',
            mensagem: 'Missão abandonada com sucesso. O contrato voltou a ficar disponível para outros pilotos.',
            pilot_credits: pilotAfter
        });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[abandonContract Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

module.exports = {
    getAvailableContracts,
    getActiveContracts,
    getIssuerContracts,
    createContract,
    editContract,
    cancelContract,
    reactivateContract,
    cloneContract,
    acceptContract,
    deliverContract,
    abandonContract
};
