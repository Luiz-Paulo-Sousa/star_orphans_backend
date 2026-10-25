const db = require('../config/database');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.resolve(__dirname, '..', 'storage', 'uploads');
const avatarsDir = path.resolve(uploadsDir, 'avatars');

const getPlayerProfile = async (req, res) => {
    const accountId = req.query.account_id;
    if (!accountId) {
        return res.status(400).json({ status: "erro", mensagem: "Parâmetro account_id é obrigatório." });
    }

    let conn;
    try {
        conn = await db.getConnection();
        const playerRows = await conn.query(
            `SELECT 
                a.uid AS account_id,
                a.account AS operator_name,
                a.avatar_url,
                COALESCE(c.name, 'Freelancer') AS corporation_name,
                s.name AS sector_name,
                st.name AS station_name,
                COALESCE(w.credits, 0) AS credits,
                COALESCE(ps.kills, 0) AS kills,
                COALESCE(ps.deaths, 0) AS deaths,
                COALESCE(ps.assists, 0) AS assists,
                COALESCE(ps.explorer, 0) AS explorer,
                COALESCE(ps.extractor, 0) AS extractor,
                COALESCE(ps.merchant, 0) AS merchant,
                COALESCE(ps.engineer, 0) AS engineer,
                COALESCE(ps.mercenary, 0) AS mercenary
            FROM accounts a
            LEFT JOIN pilots p ON p.pilot_uid = a.uid
            LEFT JOIN corporation_members cm ON cm.pilot_uid = p.pilot_uid
            LEFT JOIN corporations c ON c.corporation_uid = cm.corporation_uid
            LEFT JOIN sectors s ON s.id = p.orbit
            LEFT JOIN sector_stations st ON st.id = p.station
            LEFT JOIN wallets w ON w.wallet_uid = a.uid
            LEFT JOIN pilot_stats ps ON ps.pilot_uid = a.uid
            WHERE a.uid = ?
            LIMIT 1`,
            [accountId]
        );

        if (playerRows.length === 0) {
            return res.status(404).json({ status: "erro", mensagem: "Jogador não encontrado." });
        }

        const playerData = playerRows[0];
        const sectorStr = playerData.sector_name || 'DESCONHECIDO';
        const stationStr = playerData.station_name || 'DESCONHECIDO';
        const locationFormatted = `KALI – ${sectorStr.toUpperCase()} – ${stationStr.toUpperCase()}`;

        const reputationRows = await conn.query(
            `SELECT f.name AS faction_name, COALESCE(pp.percentage, 0) AS percentage 
             FROM factions f 
             LEFT JOIN pilot_prestige pp ON pp.faction_uid = f.faction_uid AND pp.pilot_uid = ? 
             ORDER BY f.faction_uid ASC`,
            [accountId]
        );

        const reputations = reputationRows.map(row => ({
            faction_name: row.faction_name,
            percentage: Number(row.percentage)
        }));

        return res.json({
            status: "sucesso",
            data: {
                operator: {
                    account_id: Number(playerData.account_id),
                    name: playerData.operator_name,
                    corporation: playerData.corporation_name,
                    location: locationFormatted,
                    credits: Number(playerData.credits),
                    avatar_url: playerData.avatar_url || null
                },
                stats: {
                    kills: Number(playerData.kills),
                    deaths: Number(playerData.deaths),
                    assists: Number(playerData.assists)
                },
                reputations: reputations,
                skills: {
                    explorer: Number(playerData.explorer),
                    extractor: Number(playerData.extractor),
                    merchant: Number(playerData.merchant),
                    engineer: Number(playerData.engineer),
                    mercenary: Number(playerData.mercenary)
                }
            }
        });
    } catch (err) {
        console.error("[Player Profile Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

const uploadAvatar = async (req, res) => {
    const { account_id } = req.body;
    if (!account_id || !req.file) {
        return res.status(400).json({ status: "erro", mensagem: "account_id e o arquivo de imagem são obrigatórios." });
    }

    let conn;
    try {
        if (fs.existsSync(avatarsDir)) {
            const files = fs.readdirSync(avatarsDir);
            files.forEach(file => {
                if (file.startsWith(`${account_id}.`) && file !== req.file.filename) {
                    try { fs.unlinkSync(path.join(avatarsDir, file)); } catch (e) {}
                }
            });
        }

        const avatarUrl = `/uploads/avatars/${req.file.filename}`;
        conn = await db.getConnection();
        await conn.query("UPDATE accounts SET avatar_url = ? WHERE uid = ?", [avatarUrl, account_id]);

        return res.json({ status: "sucesso", mensagem: "Avatar atualizado com sucesso!", avatar_url: avatarUrl });
    } catch (err) {
        console.error("[Upload Avatar Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

module.exports = { getPlayerProfile, uploadAvatar };