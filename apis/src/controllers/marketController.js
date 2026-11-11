const db = require('../config/database');

const formatItemCode = (code) => {
    const str = String(code || '');
    if (str.length === 8) {
        return `${str.slice(0, 2)}.${str.slice(2, 5)}.${str.slice(5)}`;
    }
    return str;
};

const buildItemDescription = (row) => {
    const t = Number(row.item_type);
    const g = String(row.group_name || '').toUpperCase();
    if (t === 6) {
        const weapons = Number(row.energy_hardpoints || 0) + Number(row.balistic_hardpoints || 0);
        const missiles = Number(row.missile_hardpoints || 0);
        return `Espa\u00e7onave classe ${g} com por\u00e3o de ${row.volume || 0} m\u00b3, ${weapons} hardpoints de armas e ${missiles} de m\u00edsseis.`;
    }
    if (t === 1) {
        return `Insumo industrial (${g}) utilizado em manufatura, refinaria e constru\u00e7\u00e3o de componentes na esta\u00e7\u00e3o.`;
    }
    if (t === 2) {
        return `Armamento prim\u00e1rio classe ${g}. Projetado para engajamento direto com consumo de ${row.weapon_mw ?? 0} MW.`;
    }
    if (t === 3) {
        return `Armamento guiado/bal\u00edstico classe ${g} de alto impacto (${row.damage_per_second ?? 0} DPS).`;
    }
    if (t === 4) {
        return `Dispositivo t\u00e1tico de melhoria para o m\u00f3dulo de ${(row.target_module_name || 'Sistema').toUpperCase()}.`;
    }
    if (t === 5) {
        const uType = row.usage_type === 'rechargeable' ? 'recarreg\u00e1vel' : 'consum\u00edvel';
        return `Utilit\u00e1rio t\u00e1tico ${uType} (${g}) para suporte operacional e contramedidas.`;
    }
    return `Item catalogado pela Coaliz\u00e3o (${g}).`;
};

const buildEffectLabel = (row) => {
    const t = Number(row.item_type);
    if (t === 6 && row.armor != null) {
        return `Casco ${row.armor} | Vel. ${row.max_speed || 0} m/s`;
    }
    if (t === 4 && row.device_effect_value != null) {
        const val = Number(row.device_effect_value);
        if (row.device_effect_type === 'percent') return `+${val}% ${row.target_module_name || ''}`.trim();
        return `+${val} MW (${row.target_module_name || ''})`.trim();
    }
    if (t === 5 && row.utility_effect_value != null) {
        const val = Number(row.utility_effect_value);
        const g = String(row.group_name || '').toUpperCase();
        if (g === 'NANOBOTS') return `+${val} HP Casco`;
        if (g === 'BATTERY') return `+${val} MW Energia`;
        if (g === 'BOOST') return `+${val}% Velocidade`;
        if (g === 'MINE') return `${val} Dano Explosivo`;
        if (g === 'EMP' || g === 'ECM' || g === 'FLARE' || g === 'CHAFF') return `${val}s Dura\u00e7\u00e3o`;
        return `${val}`;
    }
    return null;
};

async function ensurePilotStationContext(conn, pilotUid) {
    const pilotRows = await conn.query(
        `SELECT 
            p.pilot_uid,
            p.pilot AS pilot_name,
            p.orbit,
            p.station,
            p.docked,
            s.name AS orbit_name,
            st.name AS station_name,
            COALESCE(w.credits, 0) AS credits
         FROM pilots p
         LEFT JOIN orbits s ON s.id = p.orbit
         LEFT JOIN orbit_stations st ON st.id = p.station
         LEFT JOIN wallets w ON w.wallet_uid = p.pilot_uid
         WHERE p.pilot_uid = ?
         LIMIT 1`,
        [pilotUid]
    );

    if (pilotRows.length === 0) return null;
    const pilot = pilotRows[0];
    const stationId = Number(pilot.station) || 1;
    const orbitId = Number(pilot.orbit) || 2;

    await conn.query("INSERT IGNORE INTO wallets (wallet_uid, cash, credits) VALUES (0, 0, 999999999)");
    await conn.query("INSERT IGNORE INTO wallets (wallet_uid, cash, credits) VALUES (?, 0, 1000000)", [pilotUid]);

    let mktRows = await conn.query(
        "SELECT market_uid FROM markets WHERE orbit = ? AND station = ? LIMIT 1",
        [orbitId, stationId]
    );
    let marketUid;
    if (mktRows.length === 0) {
        const fallback = await conn.query(
            "SELECT market_uid FROM markets WHERE station = ? LIMIT 1",
            [stationId]
        );
        if (fallback.length > 0) {
            marketUid = Number(fallback[0].market_uid);
        } else {
            await conn.query(
                "INSERT INTO markets (market_uid, orbit, station) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE orbit = VALUES(orbit), station = VALUES(station)",
                [stationId, orbitId, stationId]
            );
            marketUid = stationId;
        }
    } else {
        marketUid = Number(mktRows[0].market_uid);
    }

    let contRows = await conn.query(
        "SELECT container_uid, max_volume, current_volume FROM containers WHERE owner = ? AND storage = ? AND type = 'hangar' LIMIT 1",
        [pilotUid, stationId]
    );
    let containerUid;
    if (contRows.length === 0) {
        const res = await conn.query(
            "INSERT INTO containers (owner, storage, type, max_volume, current_volume, protected) VALUES (?, ?, 'hangar', 50000, 0, 'y')",
            [pilotUid, stationId]
        );
        containerUid = Number(res.insertId);
    } else {
        containerUid = Number(contRows[0].container_uid);
    }

    const wRows = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1", [pilotUid]);
    const credits = wRows.length > 0 ? Number(wRows[0].credits) : Number(pilot.credits);

    return {
        pilot_uid: Number(pilot.pilot_uid),
        pilot_name: pilot.pilot_name,
        orbit: orbitId,
        station: stationId,
        docked: String(pilot.docked || 'y').toLowerCase() === 'y',
        orbit_name: pilot.orbit_name || `\u00d3RBITA ${orbitId}`,
        station_name: pilot.station_name || `ESTA\u00c7\u00c3O ${stationId}`,
        location_label: `${(pilot.orbit_name || `\u00d3RBITA ${orbitId}`).toUpperCase()} - ${(pilot.station_name || `ESTA\u00c7\u00c3O ${stationId}`).toUpperCase()}`,
        credits,
        market_uid: marketUid,
        container_uid: containerUid
    };
}

const getMarketCatalog = async (req, res) => {
    const pilotUid = req.params.pilotUid || req.query.pilot_uid;
    if (!pilotUid) {
        return res.status(400).json({ status: 'erro', mensagem: 'Par\u00e2metro pilot_uid \u00e9 obrigat\u00f3rio.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        const ctx = await ensurePilotStationContext(conn, pilotUid);
        if (!ctx) {
            return res.status(404).json({ status: 'erro', mensagem: 'Piloto n\u00e3o encontrado.' });
        }

        // 1. Estoque de itens (1..5) no deposito desta estacao
        const slotRows = await conn.query(
            "SELECT item_code, SUM(amount) AS total_amount FROM container_slots WHERE container_uid = ? GROUP BY item_code",
            [ctx.container_uid]
        );
        const playerStockMap = {};
        for (const r of slotRows) {
            playerStockMap[Number(r.item_code)] = Number(r.total_amount);
        }

        // 2. Estoque de naves (item_type = 6) do piloto atracadas nesta mesma estacao
        const vesselStockRows = await conn.query(
            "SELECT item_code, COUNT(*) AS total_ships FROM vessels WHERE pilot_uid = ? AND orbit = ? AND station = ? GROUP BY item_code",
            [ctx.pilot_uid, ctx.orbit, ctx.station]
        );
        let totalPilotShipsAtStation = 0;
        for (const vr of vesselStockRows) {
            const count = Number(vr.total_ships || 0);
            playerStockMap[Number(vr.item_code)] = count;
            totalPilotShipsAtStation += count;
        }
        ctx.total_ships_at_station = totalPilotShipsAtStation;

        const rows = await conn.query(
            `SELECT 
                mi.market_uid,
                mi.item_code,
                mi.owner_pilot_uid,
                mi.selling_price,
                mi.buying_price,
                mi.base_price,
                mi.stock,
                p.pilot AS owner_pilot_name,
                i.item_type,
                i.group_code,
                i.name AS item_name,
                i.price AS catalog_price,
                i.volume,
                i.stack,
                i.image,
                it.type AS type_name,
                ig.name AS group_name,
                ws.damage_per_second,
                ws.energy_consumption AS weapon_mw,
                ws.fire_range,
                ws.fire_rate,
                ws.auto_fire,
                ds.target_module_uid,
                vm.name AS target_module_name,
                ds.energy_consumption AS device_mw,
                ds.effect_value AS device_effect_value,
                ds.effect_type AS device_effect_type,
                us.usage_type,
                us.energy_consumption AS utility_mw,
                us.cooldown_seconds,
                us.effect_value AS utility_effect_value,
                us.effect_range AS utility_effect_range,
                vsp.energy_hardpoints,
                vsp.balistic_hardpoints,
                vsp.missile_hardpoints,
                vsp.devices AS vessel_devices,
                vsp.utilities AS vessel_utilities,
                vsp.max_speed,
                vsp.max_energy,
                vsp.armor
             FROM market_items mi
             INNER JOIN items i ON i.item_code = mi.item_code
             LEFT JOIN item_types it ON it.type_code = i.item_type
             LEFT JOIN item_groups ig ON ig.group_code = i.group_code
             LEFT JOIN pilots p ON p.pilot_uid = mi.owner_pilot_uid
             LEFT JOIN weapon_specs ws ON ws.item_code = i.item_code
             LEFT JOIN device_specs ds ON ds.item_code = i.item_code
             LEFT JOIN vessel_modules vm ON vm.module_uid = ds.target_module_uid
             LEFT JOIN utility_specs us ON us.item_code = i.item_code
             LEFT JOIN vessel_specs vsp ON vsp.item_code = i.item_code
             WHERE mi.market_uid = ? AND i.item_type IN (1, 2, 3, 4, 5, 6) AND i.active = 'SIM'
             ORDER BY i.item_type ASC, i.price ASC, i.item_code ASC, mi.owner_pilot_uid ASC`,
            [ctx.market_uid]
        );

        const stationPriceByItem = {};
        for (const r of rows) {
            if (Number(r.owner_pilot_uid) === 0) {
                stationPriceByItem[Number(r.item_code)] = Math.round(Number(r.selling_price || r.catalog_price || 100));
            }
        }

        const items = rows.map(r => {
            const iCode = Number(r.item_code);
            const iType = Number(r.item_type);
            const ownerUid = Number(r.owner_pilot_uid || 0);
            const buyPrice = Math.round(Number(r.selling_price || r.catalog_price || 100));
            const baseStationPrice = stationPriceByItem[iCode] || Math.round(Number(r.catalog_price || buyPrice));
            const sellToStationPrice = Math.round(baseStationPrice * 0.80);

            const mw = iType === 6
                ? (r.max_energy != null ? Number(r.max_energy) : null)
                : (r.weapon_mw ?? r.device_mw ?? r.utility_mw ?? null);
            const range = r.fire_range != null
                ? Number(r.fire_range)
                : (r.utility_effect_range != null && Number(r.utility_effect_range) > 0 ? Number(r.utility_effect_range) : null);

            let targetMod = r.target_module_name || null;
            if (iType === 6 && r.energy_hardpoints != null) {
                const totalW = Number(r.energy_hardpoints || 0) + Number(r.balistic_hardpoints || 0);
                targetMod = `${totalW} Armas / ${Number(r.missile_hardpoints || 0)} M\u00eds.`;
            }

            return {
                market_uid: Number(r.market_uid),
                item_code: iCode,
                item_code_formatted: formatItemCode(iCode),
                owner_pilot_uid: ownerUid,
                owner_type: ownerUid === 0 ? 'station' : 'pilot',
                owner_name: ownerUid === 0 ? 'ESTA\u00c7\u00c3O COMERCIAL' : (r.owner_pilot_name || `PILOTO #${ownerUid}`),
                is_own_listing: ownerUid > 0 && ownerUid === ctx.pilot_uid,
                name: r.item_name,
                item_type: iType,
                type_name: r.type_name || '',
                group_code: Number(r.group_code),
                group_name: r.group_name || '',
                volume: Number(r.volume || 1),
                stack: Number(r.stack || 1),
                image_url: r.image || null,
                buy_price: buyPrice,
                sell_price: sellToStationPrice,
                station_stock: Number(r.stock || 0),
                player_stock: Number(playerStockMap[iCode] || 0),
                description: buildItemDescription(r),
                specs: {
                    dps: r.damage_per_second != null ? Number(r.damage_per_second) : null,
                    energy_mw: mw != null ? Number(mw) : null,
                    fire_range: range,
                    fire_rate: r.fire_rate != null ? Number(r.fire_rate) : null,
                    auto_fire: r.auto_fire != null ? (r.auto_fire === 'y' ? 'SIM' : 'N\u00c3O') : null,
                    target_module: targetMod,
                    effect_label: buildEffectLabel(r),
                    usage_type: r.usage_type ? (r.usage_type === 'rechargeable' ? 'RECARREG\u00c1VEL' : 'CONSUM\u00cdVEL') : null,
                    cooldown_seconds: r.cooldown_seconds != null && Number(r.cooldown_seconds) > 0 ? Number(r.cooldown_seconds) : null
                }
            };
        });

        return res.json({
            status: 'sucesso',
            data: {
                context: ctx,
                items
            }
        });
    } catch (err) {
        console.error('[Market getMarketCatalog Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

const buyMarketItem = async (req, res) => {
    const { pilot_uid, item_code, owner_pilot_uid = 0, quantity = 1 } = req.body;
    const qty = Math.max(1, parseInt(quantity, 10) || 1);

    if (!pilot_uid || !item_code) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilot_uid e item_code s\u00e3o obrigat\u00f3rios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const ctx = await ensurePilotStationContext(conn, pilot_uid);
        if (!ctx) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Piloto n\u00e3o encontrado.' });
        }

        const ownerUid = Number(owner_pilot_uid || 0);
        if (ownerUid > 0 && ownerUid === ctx.pilot_uid) {
            await conn.rollback();
            return res.status(400).json({
                status: 'erro',
                mensagem: 'Este an\u00fancio pertence a voc\u00ea. Use a op\u00e7\u00e3o de recolher an\u00fancio.'
            });
        }

        const mktRows = await conn.query(
            `SELECT mi.*, i.name AS item_name, i.volume, i.item_type
             FROM market_items mi
             INNER JOIN items i ON i.item_code = mi.item_code
             WHERE mi.market_uid = ? AND mi.item_code = ? AND mi.owner_pilot_uid = ? AND i.active = 'SIM'
             FOR UPDATE`,
            [ctx.market_uid, item_code, ownerUid]
        );

        if (mktRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Item ou an\u00fancio n\u00e3o encontrado nesta esta\u00e7\u00e3o.' });
        }

        const listing = mktRows[0];
        const currentStock = Number(listing.stock || 0);
        if (currentStock < qty) {
            await conn.rollback();
            return res.status(400).json({
                status: 'erro',
                mensagem: `Estoque insuficiente na esta\u00e7\u00e3o/an\u00fancio (dispon\u00edvel: ${currentStock}).`
            });
        }

        const unitPrice = Math.round(Number(listing.selling_price));
        const totalCost = unitPrice * qty;

        if (ctx.credits < totalCost) {
            await conn.rollback();
            return res.status(400).json({
                status: 'erro',
                mensagem: `Cr\u00e9ditos insuficientes! Necess\u00e1rio: ${totalCost} CR | Saldo: ${ctx.credits} CR.`
            });
        }

        const buyerBefore = ctx.credits;
        const buyerAfter = buyerBefore - totalCost;
        await conn.query("UPDATE wallets SET credits = ? WHERE wallet_uid = ?", [buyerAfter, ctx.pilot_uid]);

        let sellerBefore = 0;
        let sellerAfter = 0;
        if (ownerUid > 0) {
            await conn.query("INSERT IGNORE INTO wallets (wallet_uid, cash, credits) VALUES (?, 0, 1000000)", [ownerUid]);
            const sellerW = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? FOR UPDATE", [ownerUid]);
            sellerBefore = sellerW.length > 0 ? Number(sellerW[0].credits) : 0;
            sellerAfter = sellerBefore + totalCost;
            await conn.query("UPDATE wallets SET credits = ? WHERE wallet_uid = ?", [sellerAfter, ownerUid]);
        }

        await conn.query(
            `INSERT INTO wallet_transactions (wallet_from, wallet_to, amount, balance_from_before, balance_from_after, balance_to_before, balance_to_after, operation_type, reference_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ctx.pilot_uid, ownerUid, totalCost, buyerBefore, buyerAfter, sellerBefore, sellerAfter, ownerUid > 0 ? 'market_p2p_buy' : 'market_station_buy', item_code]
        );

        const newStock = currentStock - qty;
        if (ownerUid > 0 && newStock <= 0) {
            await conn.query(
                "DELETE FROM market_items WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ?",
                [ctx.market_uid, item_code, ownerUid]
            );
        } else {
            await conn.query(
                "UPDATE market_items SET stock = ? WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ?",
                [newStock, ctx.market_uid, item_code, ownerUid]
            );
        }

        // Se for uma NAVE (item_type = 6), registra na tabela vessels do Hangar da estacao atual!
        if (Number(listing.item_type) === 6) {
            const activeCheck = await conn.query(
                "SELECT COUNT(*) AS active_cnt FROM vessels WHERE pilot_uid = ? AND selected = 'y'",
                [ctx.pilot_uid]
            );
            let hasActive = Number(activeCheck[0]?.active_cnt || 0) > 0;
            for (let i = 0; i < qty; i++) {
                const selFlag = !hasActive ? 'y' : 'n';
                hasActive = true;
                await conn.query(
                    `INSERT INTO vessels (pilot_uid, item_code, selected, engine, sensors, life_support, inertial_damper, integrity, orbit, station)
                     VALUES (?, ?, ?, 100, 100, 100, 100, 100, ?, ?)`,
                    [ctx.pilot_uid, item_code, selFlag, ctx.orbit, ctx.station]
                );
            }
        } else {
            // Item normal (1..5): adiciona ao container_slots do comprador na estacao
            const existingSlot = await conn.query(
                "SELECT slot, amount FROM container_slots WHERE container_uid = ? AND item_code = ? LIMIT 1 FOR UPDATE",
                [ctx.container_uid, item_code]
            );

            if (existingSlot.length > 0) {
                await conn.query(
                    "UPDATE container_slots SET amount = amount + ? WHERE container_uid = ? AND slot = ?",
                    [qty, ctx.container_uid, existingSlot[0].slot]
                );
            } else {
                const maxSlotRow = await conn.query(
                    "SELECT COALESCE(MAX(slot), 0) AS max_slot FROM container_slots WHERE container_uid = ?",
                    [ctx.container_uid]
                );
                const nextSlot = Number(maxSlotRow[0].max_slot || 0) + 1;
                await conn.query(
                    "INSERT INTO container_slots (container_uid, slot, item_code, amount) VALUES (?, ?, ?, ?)",
                    [ctx.container_uid, nextSlot, item_code, qty]
                );
            }
        }

        await conn.commit();

        return res.json({
            status: 'sucesso',
            mensagem: Number(listing.item_type) === 6
                ? `Nave adquirida com sucesso: ${qty}x ${listing.item_name} entregue no seu Hangar desta esta\u00e7\u00e3o!`
                : `Compra realizada: ${qty}x ${listing.item_name} por ${totalCost} CR.`,
            data: {
                new_credits: buyerAfter,
                item_code: Number(item_code),
                quantity_bought: qty
            }
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[Market buyMarketItem Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

const sellMarketItem = async (req, res) => {
    const { pilot_uid, item_code, quantity = 1 } = req.body;
    const qty = Math.max(1, parseInt(quantity, 10) || 1);

    if (!pilot_uid || !item_code) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilot_uid e item_code s\u00e3o obrigat\u00f3rios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const ctx = await ensurePilotStationContext(conn, pilot_uid);
        if (!ctx) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Piloto n\u00e3o encontrado.' });
        }

        const mktRows = await conn.query(
            `SELECT mi.selling_price, i.price AS catalog_price, i.name AS item_name, i.item_type
             FROM items i
             LEFT JOIN market_items mi ON mi.market_uid = ? AND mi.item_code = i.item_code AND mi.owner_pilot_uid = 0
             WHERE i.item_code = ? AND i.active = 'SIM'
             LIMIT 1`,
            [ctx.market_uid, item_code]
        );

        if (mktRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Item n\u00e3o catalogado.' });
        }

        const itemInfo = mktRows[0];
        const isShip = Number(itemInfo.item_type) === 6;
        const basePurchasePrice = Math.round(Number(itemInfo.selling_price || itemInfo.catalog_price || 100));
        const unitSellPrice = Math.round(basePurchasePrice * 0.80);
        const totalReceived = unitSellPrice * qty;

        if (isShip) {
            // Verifica naves do piloto nesta estacao (priorizando vender naves nao ativas primeiro)
            const allStationShips = await conn.query(
                "SELECT vessel_uid, item_code, selected, integrity, engine, sensors, life_support, inertial_damper FROM vessels WHERE pilot_uid = ? AND orbit = ? AND station = ? ORDER BY (selected = 'y') ASC, vessel_uid DESC FOR UPDATE",
                [ctx.pilot_uid, ctx.orbit, ctx.station]
            );
            const matchingShips = allStationShips.filter(v => Number(v.item_code) === Number(item_code));

            if (matchingShips.length < qty) {
                await conn.rollback();
                return res.status(400).json({
                    status: 'erro',
                    mensagem: `Voc\u00ea n\u00e3o possui ${qty} nave(s) deste modelo atracada(s) nesta esta\u00e7\u00e3o.`
                });
            }
            if (allStationShips.length - qty < 1) {
                await conn.rollback();
                return res.status(400).json({
                    status: 'erro',
                    mensagem: 'Voc\u00ea n\u00e3o pode vender sua \u00fanica nave na esta\u00e7\u00e3o! Mantenha ao menos uma nave operacional.'
                });
            }

            const shipsToSell = matchingShips.slice(0, qty);
            for (const sh of shipsToSell) {
                const avgInt = (Number(sh.integrity ?? 100) + Number(sh.engine ?? 100) + Number(sh.sensors ?? 100) + Number(sh.life_support ?? 100) + Number(sh.inertial_damper ?? 100)) / 5.0;
                if (avgInt < 100) {
                    await conn.rollback();
                    return res.status(400).json({
                        status: 'erro',
                        mensagem: `A nave ${itemInfo.item_name} (#${sh.vessel_uid}) est\u00e1 danificada (${avgInt.toFixed(1)}%). Repare-a no Hangar antes de vender!`
                    });
                }
            }

            let soldActive = false;
            const soldIds = shipsToSell.map(s => Number(s.vessel_uid));
            for (const sh of shipsToSell) {
                if (String(sh.selected || 'n').toLowerCase() === 'y') soldActive = true;
                await conn.query("DELETE FROM vessels WHERE vessel_uid = ? AND pilot_uid = ?", [sh.vessel_uid, ctx.pilot_uid]);
            }

            if (soldActive) {
                const remaining = allStationShips.find(s => !soldIds.includes(Number(s.vessel_uid)));
                if (remaining) {
                    await conn.query("UPDATE vessels SET selected = 'y' WHERE vessel_uid = ?", [remaining.vessel_uid]);
                }
            }
        } else {
            const slotRows = await conn.query(
                "SELECT slot, amount FROM container_slots WHERE container_uid = ? AND item_code = ? ORDER BY slot ASC FOR UPDATE",
                [ctx.container_uid, item_code]
            );

            const totalOwned = slotRows.reduce((acc, r) => acc + Number(r.amount || 0), 0);
            if (totalOwned < qty) {
                await conn.rollback();
                return res.status(400).json({
                    status: 'erro',
                    mensagem: `Voc\u00ea n\u00e3o possui quantidade suficiente no dep\u00f3sito desta esta\u00e7\u00e3o (possui: ${totalOwned}).`
                });
            }

            let remainingToRemove = qty;
            for (const s of slotRows) {
                if (remainingToRemove <= 0) break;
                const slotAmt = Number(s.amount);
                if (slotAmt <= remainingToRemove) {
                    await conn.query(
                        "DELETE FROM container_slots WHERE container_uid = ? AND slot = ?",
                        [ctx.container_uid, s.slot]
                    );
                    remainingToRemove -= slotAmt;
                } else {
                    await conn.query(
                        "UPDATE container_slots SET amount = amount - ? WHERE container_uid = ? AND slot = ?",
                        [remainingToRemove, ctx.container_uid, s.slot]
                    );
                    remainingToRemove = 0;
                }
            }
        }

        await conn.query(
            `INSERT INTO market_items (market_uid, item_code, owner_pilot_uid, ideal_stock, selling_price, buying_price, base_price, stock)
             VALUES (?, ?, 0, 100, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE stock = stock + VALUES(stock)`,
            [ctx.market_uid, item_code, basePurchasePrice, unitSellPrice, basePurchasePrice, qty]
        );

        const balanceBefore = ctx.credits;
        const balanceAfter = balanceBefore + totalReceived;
        await conn.query("UPDATE wallets SET credits = ? WHERE wallet_uid = ?", [balanceAfter, ctx.pilot_uid]);
        await conn.query(
            `INSERT INTO wallet_transactions (wallet_from, wallet_to, amount, balance_from_before, balance_from_after, balance_to_before, balance_to_after, operation_type, reference_id)
             VALUES (0, ?, ?, 0, 0, ?, ?, 'market_station_sell', ?)`,
            [ctx.pilot_uid, totalReceived, balanceBefore, balanceAfter, item_code]
        );

        await conn.commit();

        return res.json({
            status: 'sucesso',
            mensagem: isShip
                ? `Nave vendida para a esta\u00e7\u00e3o: ${qty}x ${itemInfo.item_name} por ${totalReceived} CR.`
                : `Venda conclu\u00edda (des\u00e1gio 20%): ${qty}x ${itemInfo.item_name} por ${totalReceived} CR.`,
            data: {
                new_credits: balanceAfter,
                unit_sell_price: unitSellPrice,
                total_received: totalReceived
            }
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[Market sellMarketItem Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

const createPlayerListing = async (req, res) => {
    const { pilot_uid, item_code, quantity = 1, unit_price } = req.body;
    const qty = Math.max(1, parseInt(quantity, 10) || 1);
    const price = Math.max(1, Math.round(Number(unit_price) || 0));

    if (!pilot_uid || !item_code || !unit_price || price <= 0) {
        return res.status(400).json({
            status: 'erro',
            mensagem: 'Informe o item, a quantidade e um pre\u00e7o unit\u00e1rio v\u00e1lido para anunciar.'
        });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const ctx = await ensurePilotStationContext(conn, pilot_uid);
        if (!ctx) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Piloto n\u00e3o encontrado.' });
        }

        const itemRows = await conn.query("SELECT item_type, name FROM items WHERE item_code = ? AND active = 'SIM' LIMIT 1", [item_code]);
        if (itemRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Item n\u00e3o encontrado.' });
        }
        const isShip = Number(itemRows[0].item_type) === 6;

        if (isShip) {
            const allStationShips = await conn.query(
                "SELECT vessel_uid, item_code, selected, integrity, engine, sensors, life_support, inertial_damper FROM vessels WHERE pilot_uid = ? AND orbit = ? AND station = ? ORDER BY (selected = 'y') ASC, vessel_uid DESC FOR UPDATE",
                [ctx.pilot_uid, ctx.orbit, ctx.station]
            );
            const matchingShips = allStationShips.filter(v => Number(v.item_code) === Number(item_code));

            if (matchingShips.length < qty) {
                await conn.rollback();
                return res.status(400).json({
                    status: 'erro',
                    mensagem: `Quantidade insuficiente desta nave no seu Hangar desta esta\u00e7\u00e3o (dispon\u00edvel: ${matchingShips.length}).`
                });
            }
            if (allStationShips.length - qty < 1) {
                await conn.rollback();
                return res.status(400).json({
                    status: 'erro',
                    mensagem: 'Voc\u00ea n\u00e3o pode anunciar sua \u00fanica nave na esta\u00e7\u00e3o!'
                });
            }

            const shipsToList = matchingShips.slice(0, qty);
            for (const sh of shipsToList) {
                const avgInt = (Number(sh.integrity ?? 100) + Number(sh.engine ?? 100) + Number(sh.sensors ?? 100) + Number(sh.life_support ?? 100) + Number(sh.inertial_damper ?? 100)) / 5.0;
                if (avgInt < 100) {
                    await conn.rollback();
                    return res.status(400).json({
                        status: 'erro',
                        mensagem: `Repare a nave ${itemRows[0].name} (#${sh.vessel_uid}) para 100% no Hangar antes de anunci\u00e1-la!`
                    });
                }
            }

            let listedActive = false;
            const listedIds = shipsToList.map(s => Number(s.vessel_uid));
            for (const sh of shipsToList) {
                if (String(sh.selected || 'n').toLowerCase() === 'y') listedActive = true;
                await conn.query("DELETE FROM vessels WHERE vessel_uid = ? AND pilot_uid = ?", [sh.vessel_uid, ctx.pilot_uid]);
            }
            if (listedActive) {
                const remaining = allStationShips.find(s => !listedIds.includes(Number(s.vessel_uid)));
                if (remaining) {
                    await conn.query("UPDATE vessels SET selected = 'y' WHERE vessel_uid = ?", [remaining.vessel_uid]);
                }
            }
        } else {
            const slotRows = await conn.query(
                "SELECT slot, amount FROM container_slots WHERE container_uid = ? AND item_code = ? ORDER BY slot ASC FOR UPDATE",
                [ctx.container_uid, item_code]
            );
            const totalOwned = slotRows.reduce((acc, r) => acc + Number(r.amount || 0), 0);
            if (totalOwned < qty) {
                await conn.rollback();
                return res.status(400).json({
                    status: 'erro',
                    mensagem: `Quantidade insuficiente no seu dep\u00f3sito desta esta\u00e7\u00e3o (dispon\u00edvel: ${totalOwned}).`
                });
            }

            let remainingToRemove = qty;
            for (const s of slotRows) {
                if (remainingToRemove <= 0) break;
                const slotAmt = Number(s.amount);
                if (slotAmt <= remainingToRemove) {
                    await conn.query("DELETE FROM container_slots WHERE container_uid = ? AND slot = ?", [ctx.container_uid, s.slot]);
                    remainingToRemove -= slotAmt;
                } else {
                    await conn.query(
                        "UPDATE container_slots SET amount = amount - ? WHERE container_uid = ? AND slot = ?",
                        [remainingToRemove, ctx.container_uid, s.slot]
                    );
                    remainingToRemove = 0;
                }
            }
        }

        await conn.query(
            `INSERT INTO market_items (market_uid, item_code, owner_pilot_uid, ideal_stock, selling_price, buying_price, base_price, stock)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               stock = stock + VALUES(stock),
               selling_price = VALUES(selling_price),
               buying_price = VALUES(buying_price),
               last_update = CURRENT_TIMESTAMP`,
            [ctx.market_uid, item_code, ctx.pilot_uid, qty, price, Math.round(price * 0.8), price, qty]
        );

        await conn.commit();
        return res.json({
            status: 'sucesso',
            mensagem: `An\u00fancio publicado na esta\u00e7\u00e3o (${ctx.station_name}): ${qty} un. por ${price} CR cada!`
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[Market createPlayerListing Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

const cancelPlayerListing = async (req, res) => {
    const { pilot_uid, item_code } = req.body;
    if (!pilot_uid || !item_code) {
        return res.status(400).json({ status: 'erro', mensagem: 'pilot_uid e item_code s\u00e3o obrigat\u00f3rios.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const ctx = await ensurePilotStationContext(conn, pilot_uid);
        if (!ctx) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'Piloto n\u00e3o encontrado.' });
        }

        const rows = await conn.query(
            `SELECT mi.stock, COALESCE(i.item_type, 1) AS item_type
             FROM market_items mi
             LEFT JOIN items i ON i.item_code = mi.item_code
             WHERE mi.market_uid = ? AND mi.item_code = ? AND mi.owner_pilot_uid = ?
             FOR UPDATE`,
            [ctx.market_uid, item_code, ctx.pilot_uid]
        );
        if (rows.length === 0 || Number(rows[0].stock) <= 0) {
            await conn.rollback();
            return res.status(404).json({ status: 'erro', mensagem: 'An\u00fancio n\u00e3o encontrado.' });
        }

        const stockToReturn = Number(rows[0].stock);
        const isShip = Number(rows[0].item_type) === 6;

        await conn.query(
            "DELETE FROM market_items WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ?",
            [ctx.market_uid, item_code, ctx.pilot_uid]
        );

        if (isShip) {
            for (let i = 0; i < stockToReturn; i++) {
                await conn.query(
                    `INSERT INTO vessels (pilot_uid, item_code, selected, engine, sensors, life_support, inertial_damper, integrity, orbit, station)
                     VALUES (?, ?, 'n', 100, 100, 100, 100, 100, ?, ?)`,
                    [ctx.pilot_uid, item_code, ctx.orbit, ctx.station]
                );
            }
        } else {
            const existingSlot = await conn.query(
                "SELECT slot FROM container_slots WHERE container_uid = ? AND item_code = ? LIMIT 1 FOR UPDATE",
                [ctx.container_uid, item_code]
            );
            if (existingSlot.length > 0) {
                await conn.query(
                    "UPDATE container_slots SET amount = amount + ? WHERE container_uid = ? AND slot = ?",
                    [stockToReturn, ctx.container_uid, existingSlot[0].slot]
                );
            } else {
                const maxSlotRow = await conn.query(
                    "SELECT COALESCE(MAX(slot), 0) AS max_slot FROM container_slots WHERE container_uid = ?",
                    [ctx.container_uid]
                );
                const nextSlot = Number(maxSlotRow[0].max_slot || 0) + 1;
                await conn.query(
                    "INSERT INTO container_slots (container_uid, slot, item_code, amount) VALUES (?, ?, ?, ?)",
                    [ctx.container_uid, nextSlot, item_code, stockToReturn]
                );
            }
        }

        await conn.commit();
        return res.json({
            status: 'sucesso',
            mensagem: isShip
                ? `An\u00fancio encerrado! ${stockToReturn} nave(s) devolvida(s) ao seu Hangar na esta\u00e7\u00e3o.`
                : `An\u00fancio encerrado! ${stockToReturn} un. devolvidas ao seu dep\u00f3sito na esta\u00e7\u00e3o.`
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[Market cancelPlayerListing Error]:', err);
        return res.status(500).json({ status: 'erro', mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

module.exports = {
    getMarketCatalog,
    buyMarketItem,
    sellMarketItem,
    createPlayerListing,
    cancelPlayerListing
};