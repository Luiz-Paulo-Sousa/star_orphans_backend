const db = require('../config/database');

/**
 * Garante que o hangar do piloto na estação atual exista
 */
async function getPilotHangarContainer(conn, pilotUid, stationId) {
    const contRows = await conn.query(
        "SELECT container_uid, max_volume, current_volume FROM containers WHERE owner = ? AND storage = ? AND type = 'hangar' LIMIT 1",
        [pilotUid, stationId]
    );
    const contList = Array.isArray(contRows) && Array.isArray(contRows[0]) ? contRows[0] : contRows;
    if (contList.length > 0) {
        return contList[0];
    }

    const res = await conn.query(
        "INSERT INTO containers (owner, storage, type, max_volume, current_volume, protected) VALUES (?, ?, 'hangar', 50000, 0, 'y')",
        [pilotUid, stationId]
    );
    return { container_uid: Number(res.insertId), max_volume: 50000, current_volume: 0 };
}

/**
 * Retorna dados da estação atual do piloto, créditos e tipo de instalação (fabrica / fundicao)
 */
const getStationFactoryInfo = async (req, res) => {
    const { pilotUid } = req.params;
    if (!pilotUid) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilotUid é obrigatório.' });
    }

    let conn;
    try {
        conn = await db.getConnection();

        // 1. Busca localização do piloto
        const pilotRows = await conn.query(
            `SELECT p.pilot_uid, p.pilot AS pilot_name, p.orbit, p.station, p.docked,
                    s.name AS orbit_name,
                    st.name AS station_name,
                    COALESCE(st.station_type, 'fabrica') AS station_type,
                    st.faction_uid,
                    COALESCE(w.credits, 0) AS credits
             FROM pilots p
             LEFT JOIN orbits s ON s.id = p.orbit
             LEFT JOIN orbit_stations st ON st.id = p.station
             LEFT JOIN wallets w ON w.wallet_uid = p.pilot_uid
             WHERE p.pilot_uid = ? LIMIT 1`,
            [pilotUid]
        );
        const pilotList = Array.isArray(pilotRows) && Array.isArray(pilotRows[0]) ? pilotRows[0] : pilotRows;

        if (pilotList.length === 0) {
            return res.status(404).json({ status: 'erro', mensagem: 'Piloto não encontrado.' });
        }

        const pilot = pilotList[0];
        const stationId = Number(pilot.station || 1);
        const hangar = await getPilotHangarContainer(conn, pilotUid, stationId);

        return res.json({
            status: 'sucesso',
            pilot: {
                pilot_uid: pilot.pilot_uid,
                name: pilot.pilot_name,
                credits: Number(pilot.credits),
                orbit_id: pilot.orbit,
                orbit_name: pilot.orbit_name,
                station_id: stationId,
                station_name: pilot.station_name,
                station_type: pilot.station_type,
                docked: pilot.docked === 'y'
            },
            hangar: {
                container_uid: Number(hangar.container_uid),
                max_volume: Number(hangar.max_volume),
                current_volume: Number(hangar.current_volume)
            }
        });
    } catch (err) {
        console.error('[FactoryController] Erro em getStationFactoryInfo:', err);
        return res.status(500).json({ status: 'erro', mensagem: 'Erro interno ao obter dados da fábrica.' });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Retorna as receitas disponíveis para a estação atual do piloto,
 * indicando os recursos necessários e a disponibilidade no hangar.
 */
const getAvailableRecipes = async (req, res) => {
    const { pilotUid } = req.params;
    if (!pilotUid) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilotUid é obrigatório.' });
    }

    let conn;
    try {
        conn = await db.getConnection();

        // 1. Identifica a estação atual do piloto e seu tipo
        const pilotRows = await conn.query(
            `SELECT p.station, COALESCE(st.station_type, 'fabrica') AS station_type,
                    COALESCE(w.credits, 0) AS credits
             FROM pilots p
             LEFT JOIN orbit_stations st ON st.id = p.station
             LEFT JOIN wallets w ON w.wallet_uid = p.pilot_uid
             WHERE p.pilot_uid = ? LIMIT 1`,
            [pilotUid]
        );
        const pilotList = Array.isArray(pilotRows) && Array.isArray(pilotRows[0]) ? pilotRows[0] : pilotRows;

        if (pilotList.length === 0) {
            return res.status(404).json({ status: 'erro', mensagem: 'Piloto não encontrado.' });
        }

        const stationId = Number(pilotList[0].station || 1);
        const stationType = pilotList[0].station_type;
        const playerCredits = Number(pilotList[0].credits || 0);

        // 2. Localiza o hangar do piloto nessa estação
        const hangar = await getPilotHangarContainer(conn, pilotUid, stationId);
        const containerUid = Number(hangar.container_uid);

        // 3. Busca o estoque atual do hangar do piloto
        const stockRows = await conn.query(
            "SELECT item_code, SUM(amount) AS total_amount FROM container_slots WHERE container_uid = ? GROUP BY item_code",
            [containerUid]
        );
        const stockList = Array.isArray(stockRows) && Array.isArray(stockRows[0]) ? stockRows[0] : stockRows;
        const stockMap = new Map();
        stockList.forEach(s => stockMap.set(Number(s.item_code), Number(s.total_amount)));

        // 4. Busca todas as receitas e dados dos itens produzidos
        const recipeRows = await conn.query(
            `SELECT 
                cr.item_code,
                cr.time AS craft_time,
                cr.cost,
                cr.tier,
                i.name AS item_name,
                i.item_type,
                i.group_code,
                i.volume,
                i.price AS market_price,
                i.image
             FROM craft_recipes cr
             INNER JOIN items i ON i.item_code = cr.item_code
             ORDER BY i.item_type ASC, cr.cost ASC`
        );
        const allRecipes = Array.isArray(recipeRows) && Array.isArray(recipeRows[0]) ? recipeRows[0] : recipeRows;

        // 5. Busca todos os recursos/ingredientes de todas as receitas
        const resourceRows = await conn.query(
            `SELECT 
                crr.recipe_item_code,
                crr.item_required,
                crr.amount AS required_amount,
                i.name AS ingredient_name,
                i.image AS ingredient_image
             FROM craft_recipe_resources crr
             INNER JOIN items i ON i.item_code = crr.item_required`
        );
        const allResources = Array.isArray(resourceRows) && Array.isArray(resourceRows[0]) ? resourceRows[0] : resourceRows;

        // Agrupa recursos por recipe_item_code
        const resourcesByRecipe = new Map();
        allResources.forEach(r => {
            const code = Number(r.recipe_item_code);
            if (!resourcesByRecipe.has(code)) {
                resourcesByRecipe.set(code, []);
            }
            resourcesByRecipe.get(code).push(r);
        });

        // 6. Filtra de acordo com a regra de negócio da estação:
        //    - FUNDIÇÃO (fundicao): aceita apenas itens cujo insumo é minério bruto (group_code IN (1, 2, 3) -> Ferro, Eletrônicos)
        //    - FÁBRICA (fabrica): aceita todos os demais (Aço, Armas, Mísseis, Dispositivos, Utilitários, Naves)
        const isFoundry = stationType === 'fundicao';

        const filteredRecipes = [];

        for (const recipe of allRecipes) {
            const itemCode = Number(recipe.item_code);
            const ingredients = resourcesByRecipe.get(itemCode) || [];

            // Classificação: Fundição vs Fábrica
            // Se o item for beneficiamento de minério (código 80000004 Eletrônicos ou 80000005 Ferro)
            const isSmelting = (itemCode === 80000004 || itemCode === 80000005);

            if (isFoundry && !isSmelting) continue;
            if (!isFoundry && isSmelting) continue;

            // Avalia recursos disponíveis no hangar
            let canCraft = playerCredits >= Number(recipe.cost);
            let maxByMaterials = Infinity;

            const ingredientsWithStock = ingredients.map(ing => {
                const reqCode = Number(ing.item_required);
                const reqQty = Number(ing.required_amount);
                const inStock = stockMap.get(reqCode) || 0;

                if (inStock < reqQty) {
                    canCraft = false;
                }

                const craftableWithThis = reqQty > 0 ? Math.floor(inStock / reqQty) : 0;
                if (craftableWithThis < maxByMaterials) {
                    maxByMaterials = craftableWithThis;
                }

                return {
                    item_code: reqCode,
                    name: ing.ingredient_name,
                    image: ing.ingredient_image,
                    required_amount: reqQty,
                    available_amount: inStock,
                    sufficient: inStock >= reqQty
                };
            });

            if (ingredients.length === 0) maxByMaterials = 0;
            if (maxByMaterials === Infinity) maxByMaterials = 0;

            const maxByCredits = recipe.cost > 0 ? Math.floor(playerCredits / recipe.cost) : 999;
            const maxCraftable = Math.min(maxByMaterials, maxByCredits);

            filteredRecipes.push({
                item_code: itemCode,
                name: recipe.item_name,
                item_type: Number(recipe.item_type),
                group_code: Number(recipe.group_code),
                craft_time: Number(recipe.craft_time),
                cost: Number(recipe.cost),
                tier: Number(recipe.tier),
                image: recipe.image,
                can_craft: canCraft && maxCraftable > 0,
                max_craftable: maxCraftable,
                ingredients: ingredientsWithStock
            });
        }

        return res.json({
            status: 'sucesso',
            station_type: stationType,
            recipes: filteredRecipes
        });
    } catch (err) {
        console.error('[FactoryController] Erro em getAvailableRecipes:', err);
        return res.status(500).json({ status: 'erro', mensagem: 'Erro interno ao carregar receitas.' });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Retorna as ordens de fabricação ativas e históricas do piloto
 */
const getPilotQueue = async (req, res) => {
    const { pilotUid } = req.params;
    if (!pilotUid) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilotUid é obrigatório.' });
    }

    let conn;
    try {
        conn = await db.getConnection();

        const queueRows = await conn.query(
            `SELECT 
                cq.queue_uid,
                cq.pilot_uid,
                cq.container_uid,
                cq.item_code,
                cq.amount,
                cq.orbit,
                cq.station,
                cq.delivery_date,
                cq.status,
                UNIX_TIMESTAMP(cq.delivery_date) * 1000 AS delivery_timestamp,
                GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), cq.delivery_date)) AS remaining_seconds,
                COALESCE(i.name, CONCAT('Item #', cq.item_code)) AS item_name,
                i.image,
                COALESCE(st.name, CONCAT('Estação #', cq.station)) AS station_name,
                COALESCE(st.station_type, 'fabrica') AS station_type
             FROM craft_queues cq
             LEFT JOIN items i ON i.item_code = cq.item_code
             LEFT JOIN orbit_stations st ON st.id = cq.station
             WHERE cq.pilot_uid = ?
             ORDER BY 
                CASE WHEN cq.status = 'in_progress' THEN 1 ELSE 2 END ASC,
                cq.delivery_date DESC
             LIMIT 50`,
            [pilotUid]
        );

        const queueList = Array.isArray(queueRows) && Array.isArray(queueRows[0]) ? queueRows[0] : queueRows;

        return res.json({
            status: 'sucesso',
            queue: queueList
        });
    } catch (err) {
        console.error('[FactoryController] Erro em getPilotQueue:', err);
        return res.status(500).json({ status: 'erro', mensagem: 'Erro interno ao consultar fila de produção.' });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Inicia a fabricação de um item:
 * 1. Valida localização, créditos e insumos no hangar
 * 2. Desconta os insumos de container_slots
 * 3. Desconta créditos de wallets
 * 4. Insere na fila craft_queues
 */
const startCrafting = async (req, res) => {
    const { pilot_uid, item_code, amount } = req.body;
    const qty = Number(amount) || 1;

    if (!pilot_uid || !item_code || qty <= 0) {
        return res.status(400).json({ status: 'erro', mensagem: 'Parâmetros pilot_uid, item_code e amount válidos são obrigatórios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        // 1. Dados do piloto e estação
        const pilotRows = await conn.query(
            `SELECT p.pilot_uid, p.orbit, p.station, p.docked,
                    COALESCE(st.station_type, 'fabrica') AS station_type,
                    COALESCE(w.credits, 0) AS credits
             FROM pilots p
             LEFT JOIN orbit_stations st ON st.id = p.station
             LEFT JOIN wallets w ON w.wallet_uid = p.pilot_uid
             WHERE p.pilot_uid = ? LIMIT 1 FOR UPDATE`,
            [pilot_uid]
        );
        const pilotList = Array.isArray(pilotRows) && Array.isArray(pilotRows[0]) ? pilotRows[0] : pilotRows;

        if (pilotList.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Piloto não encontrado.' });
        }

        const pilot = pilotList[0];
        const stationId = Number(pilot.station || 1);
        const orbitId = Number(pilot.orbit || 1);
        const stationType = pilot.station_type;
        const playerCredits = Number(pilot.credits || 0);

        // 2. Dados da receita
        const recipeRows = await conn.query(
            "SELECT item_code, time AS craft_time, cost, tier FROM craft_recipes WHERE item_code = ? LIMIT 1",
            [item_code]
        );
        const recipeList = Array.isArray(recipeRows) && Array.isArray(recipeRows[0]) ? recipeRows[0] : recipeRows;

        if (recipeList.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Receita não encontrada para este item.' });
        }

        const recipe = recipeList[0];
        const totalCost = Number(recipe.cost) * qty;
        const totalTimeSeconds = Number(recipe.craft_time) * qty;

        // Validação da regra Fundição vs Fábrica
        const isSmelting = (Number(item_code) === 80000004 || Number(item_code) === 80000005);
        if (stationType === 'fundicao' && !isSmelting) {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Esta estação é uma Fundição e aceita apenas beneficiamento de minérios brutos.' });
        }
        if (stationType !== 'fundicao' && isSmelting) {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'O beneficiamento de minérios brutos deve ser realizado em uma Fundição.' });
        }

        // Validação de Créditos
        if (playerCredits < totalCost) {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: `Créditos insuficientes. Custo necessário: ${totalCost} CR.` });
        }

        // 3. Obtém o Hangar e valida insumos
        const hangar = await getPilotHangarContainer(conn, pilot_uid, stationId);
        const containerUid = Number(hangar.container_uid);

        const resourceRows = await conn.query(
            "SELECT item_required, amount FROM craft_recipe_resources WHERE recipe_item_code = ?",
            [item_code]
        );
        const resourceList = Array.isArray(resourceRows) && Array.isArray(resourceRows[0]) ? resourceRows[0] : resourceRows;

        for (const resItem of resourceList) {
            const reqCode = Number(resItem.item_required);
            const neededQty = Number(resItem.amount) * qty;

            const slotRows = await conn.query(
                "SELECT slot, amount FROM container_slots WHERE container_uid = ? AND item_code = ? FOR UPDATE",
                [containerUid, reqCode]
            );
            const slotList = Array.isArray(slotRows) && Array.isArray(slotRows[0]) ? slotRows[0] : slotRows;
            const totalAvailable = slotList.reduce((acc, curr) => acc + Number(curr.amount), 0);

            if (totalAvailable < neededQty) {
                await conn.rollback();
                return res.status(400).json({
                    status: 'erro',
                    mensagem: `Recursos insuficientes no hangar para o item código #${reqCode}. Necessário: ${neededQty}, Disponível: ${totalAvailable}.`
                });
            }

            // Consome os insumos dos slots do contêiner
            let remainingToDeduct = neededQty;
            for (const slot of slotList) {
                if (remainingToDeduct <= 0) break;
                const slotAmt = Number(slot.amount);
                if (slotAmt <= remainingToDeduct) {
                    await conn.query("DELETE FROM container_slots WHERE container_uid = ? AND slot = ?", [containerUid, slot.slot]);
                    remainingToDeduct -= slotAmt;
                } else {
                    await conn.query("UPDATE container_slots SET amount = amount - ? WHERE container_uid = ? AND slot = ?", [remainingToDeduct, containerUid, slot.slot]);
                    remainingToDeduct = 0;
                }
            }
        }

        // 4. Desconta os créditos da carteira
        if (totalCost > 0) {
            await conn.query("UPDATE wallets SET credits = credits - ? WHERE wallet_uid = ?", [totalCost, pilot_uid]);
        }

        // 5. Insere a ordem na fila de fabricação com data de entrega calculada
        const insertQueue = await conn.query(
            `INSERT INTO craft_queues 
                (pilot_uid, container_uid, item_code, amount, orbit, station, delivery_date, status)
             VALUES 
                (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), 'in_progress')`,
            [pilot_uid, containerUid, item_code, qty, orbitId, stationId, totalTimeSeconds]
        );

        await conn.commit();

        return res.status(201).json({
            status: 'sucesso',
            mensagem: 'Ordem de fabricação iniciada com sucesso!',
            queue_uid: Number(insertQueue.insertId),
            total_time_seconds: totalTimeSeconds,
            cost: totalCost
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[FactoryController] Erro em startCrafting:', err);
        return res.status(500).json({ status: 'erro', mensagem: 'Erro interno ao iniciar fabricação.' });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * Cancela uma ordem de fabricação em andamento
 */
const cancelCrafting = async (req, res) => {
    const { queue_uid, pilot_uid } = req.body;
    if (!queue_uid || !pilot_uid) {
        return res.status(400).json({ status: 'erro', mensagem: 'queue_uid e pilot_uid são obrigatórios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const checkRows = await conn.query(
            "SELECT queue_uid, status FROM craft_queues WHERE queue_uid = ? AND pilot_uid = ? FOR UPDATE",
            [queue_uid, pilot_uid]
        );
        const checkList = Array.isArray(checkRows) && Array.isArray(checkRows[0]) ? checkRows[0] : checkRows;

        if (checkList.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Ordem de fabricação não encontrada.' });
        }

        if (checkList[0].status !== 'in_progress') {
            await conn.rollback();
            return res.status(400).json({ status: 'erro', mensagem: 'Apenas ordens em andamento podem ser canceladas.' });
        }

        await conn.query("UPDATE craft_queues SET status = 'cancelled' WHERE queue_uid = ?", [queue_uid]);
        await conn.commit();

        return res.json({ status: 'sucesso', mensagem: 'Ordem de fabricação cancelada.' });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[FactoryController] Erro em cancelCrafting:', err);
        return res.status(500).json({ status: 'erro', mensagem: 'Erro interno ao cancelar ordem.' });
    } finally {
        if (conn) conn.release();
    }
};

module.exports = {
    getStationFactoryInfo,
    getAvailableRecipes,
    getPilotQueue,
    startCrafting,
    cancelCrafting
};
