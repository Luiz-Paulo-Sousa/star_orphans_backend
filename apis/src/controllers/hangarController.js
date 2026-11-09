const db = require('../config/database');

const formatItemCode = (code) => {
    const str = String(code || '');
    if (str.length === 8) {
        return `${str.slice(0, 2)}.${str.slice(2, 5)}.${str.slice(5)}`;
    }
    return str;
};

const buildEffectLabel = (row) => {
    const t = Number(row.item_type);
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

const mapItemSpecs = (r) => {
    const mw = r.weapon_mw ?? r.device_mw ?? r.utility_mw ?? 0;
    const range = r.fire_range != null
        ? Number(r.fire_range)
        : (r.utility_effect_range != null && Number(r.utility_effect_range) > 0 ? Number(r.utility_effect_range) : 0);
    return {
        dps: r.damage_per_second != null ? Number(r.damage_per_second) : 0,
        energy: Number(mw || 0),
        range: Number(range || 0),
        fire_rate: r.fire_rate != null ? Number(r.fire_rate) : null,
        auto_fire: r.auto_fire != null ? (r.auto_fire === 'y' ? 'SIM' : 'N\u00c3O') : null,
        target_module: r.target_module_name || null,
        effect_label: buildEffectLabel(r),
        effect_value: Number(r.device_effect_value ?? r.utility_effect_value ?? 0),
        usage_type: r.usage_type ? (r.usage_type === 'rechargeable' ? 'RECARREG\u00c1VEL' : 'CONSUM\u00cdVEL') : null,
        cooldown_seconds: r.cooldown_seconds != null && Number(r.cooldown_seconds) > 0 ? Number(r.cooldown_seconds) : null
    };
};

async function ensureStationContainersAndMarket(conn, pilotUid, orbitId, stationId) {
    await conn.query("INSERT IGNORE INTO wallets (wallet_uid, cash, credits) VALUES (0, 0, 999999999)");
    await conn.query("INSERT IGNORE INTO wallets (wallet_uid, cash, credits) VALUES (?, 0, 1000000)", [pilotUid]);

    const sId = Number(stationId) || 1;
    const oId = Number(orbitId) || 1;

    let mktRows = await conn.query(
        "SELECT market_uid FROM markets WHERE orbit = ? AND station = ? LIMIT 1",
        [oId, sId]
    );
    let marketUid = sId;
    if (mktRows.length === 0) {
        const fallback = await conn.query(
            "SELECT market_uid FROM markets WHERE station = ? LIMIT 1",
            [sId]
        );
        if (fallback.length > 0) {
            marketUid = Number(fallback[0].market_uid);
        } else {
            await conn.query(
                "INSERT INTO markets (market_uid, orbit, station) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE orbit = VALUES(orbit), station = VALUES(station)",
                [sId, oId, sId]
            );
        }
    } else {
        marketUid = Number(mktRows[0].market_uid);
    }

    let contRows = await conn.query(
        "SELECT container_uid FROM containers WHERE owner = ? AND storage = ? AND type = 'hangar' LIMIT 1",
        [pilotUid, sId]
    );
    let hangarContainerUid;
    if (contRows.length === 0) {
        const res = await conn.query(
            "INSERT INTO containers (owner, storage, type, max_volume, current_volume, protected) VALUES (?, ?, 'hangar', 50000, 0, 'y')",
            [pilotUid, sId]
        );
        hangarContainerUid = Number(res.insertId);
    } else {
        hangarContainerUid = Number(contRows[0].container_uid);
    }

    return { marketUid, hangarContainerUid };
}

const getPilotFleet = async (req, res) => {
    const pilotUid = req.params.pilotUid || req.query.pilot_uid;
    if (!pilotUid) {
        return res.status(400).json({
            status: "erro",
            mensagem: "Par\u00e2metro pilot_uid \u00e9 obrigat\u00f3rio."
        });
    }

    let conn;
    try {
        conn = await db.getConnection();

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

        const pilot = pilotRows.length > 0 ? pilotRows[0] : null;
        const pilotOrbit = pilot ? Number(pilot.orbit) : 2;
        const pilotStation = pilot ? Number(pilot.station) : 1;
        const pilotCredits = pilot ? Number(pilot.credits || 0) : 0;

        const { marketUid, hangarContainerUid } = await ensureStationContainersAndMarket(conn, pilotUid, pilotOrbit, pilotStation);

        const vesselRows = await conn.query(
            `SELECT 
                v.vessel_uid,
                v.pilot_uid,
                v.item_code,
                v.selected,
                v.engine,
                v.sensors,
                v.life_support,
                v.inertial_damper,
                v.integrity,
                v.orbit,
                v.station,
                COALESCE(i.name, CONCAT('Nave #', v.vessel_uid)) AS vessel_name,
                COALESCE(i.volume, 0) AS cargo_capacity,
                COALESCE(i.price, 250000) AS base_price,
                ii.image_2d_url,
                ii.image_3d_url,
                s.name AS orbit_name,
                st.name AS station_name,
                vsp.energy_hardpoints,
                vsp.balistic_hardpoints,
                vsp.missile_hardpoints,
                vsp.devices AS spec_devices,
                vsp.utilities AS spec_utilities,
                vsp.max_energy AS spec_max_energy,
                vsp.armor AS spec_armor,
                vsp.max_speed AS spec_max_speed
            FROM vessels v
            LEFT JOIN items i ON i.item_code = v.item_code
            LEFT JOIN item_images ii ON ii.item_code = v.item_code
            LEFT JOIN orbits s ON s.id = v.orbit
            LEFT JOIN orbit_stations st ON st.id = v.station
            LEFT JOIN vessel_specs vsp ON vsp.item_code = v.item_code
            WHERE v.pilot_uid = ?
            ORDER BY (v.selected = 'y') DESC, v.vessel_uid ASC`,
            [pilotUid]
        );

        // Busca todos os equipamentos instalados nas naves deste piloto
        const equipRows = await conn.query(
            `SELECT 
                ve.vessel_uid,
                ve.slot,
                ve.item_code,
                ve.type,
                ve.amount,
                i.name AS item_name,
                i.item_type,
                i.group_code,
                i.image,
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
                us.effect_range AS utility_effect_range
            FROM vessel_equipments ve
            INNER JOIN vessels v ON v.vessel_uid = ve.vessel_uid
            INNER JOIN items i ON i.item_code = ve.item_code
            LEFT JOIN item_groups ig ON ig.group_code = i.group_code
            LEFT JOIN weapon_specs ws ON ws.item_code = i.item_code
            LEFT JOIN device_specs ds ON ds.item_code = i.item_code
            LEFT JOIN vessel_modules vm ON vm.module_uid = ds.target_module_uid
            LEFT JOIN utility_specs us ON us.item_code = i.item_code
            WHERE v.pilot_uid = ?
            ORDER BY ve.vessel_uid ASC, ve.slot ASC`,
            [pilotUid]
        );

        const equipByVessel = {};
        for (const er of equipRows) {
            const vUid = Number(er.vessel_uid);
            if (!equipByVessel[vUid]) equipByVessel[vUid] = {};
            equipByVessel[vUid][Number(er.slot)] = er;
        }

        const vessels = vesselRows.map(row => {
            const vUid = Number(row.vessel_uid);
            const vOrbit = Number(row.orbit);
            const vStation = Number(row.station);
            const isAtCurrentStation =
                pilotOrbit !== null &&
                pilotStation !== null &&
                vOrbit === pilotOrbit &&
                vStation === pilotStation;

            const isSelected = String(row.selected || 'n').toLowerCase() === 'y';

            const integrity = Number(row.integrity ?? 100);
            const engine = Number(row.engine ?? 100);
            const sensors = Number(row.sensors ?? 100);
            const lifeSupport = Number(row.life_support ?? 100);
            const inertialDamper = Number(row.inertial_damper ?? 100);

            const avgIntegrity = Number(
                ((integrity + engine + sensors + lifeSupport + inertialDamper) / 5.0).toFixed(1)
            );

            const basePrice = Math.round(Number(row.base_price || 250000));
            const damagePercent = Number(Math.max(0, 100.0 - avgIntegrity).toFixed(1));
            const repairCost = Math.round(basePrice * (damagePercent / 100.0));

            let hologramUrl = null;
            if (row.image_2d_url && String(row.image_2d_url).trim() !== '') {
                const rawPath = String(row.image_2d_url).trim();
                if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
                    hologramUrl = rawPath;
                } else {
                    let fileName = rawPath.split(/[\\/]/).pop();
                    if (fileName) {
                        fileName = fileName.replace(/\.svg$/i, '.png');
                        hologramUrl = `/hologramas/${encodeURIComponent(fileName)}`;
                    }
                }
            }

            const getSubStatus = (val) => {
                if (val > 100) return 'SOBRECARGA';
                if (val < 80) return 'ATEN\u00c7\u00c3O';
                return 'NOMINAL';
            };

            const calcSubRepairCost = (val) => {
                const subDmg = Math.max(0, 100.0 - Number(val || 100));
                return Math.round(basePrice * (subDmg / 500.0));
            };

            const orbitLabel = row.orbit_name ? String(row.orbit_name).toUpperCase() : `\u00d3RBITA ${vOrbit}`;
            const stationLabel = row.station_name ? String(row.station_name).toUpperCase() : `ESTA\u00c7\u00c3O ${vStation}`;

            // Monta os slots de Hardpoints desta nave com base em vessel_specs + vessel_equipments
            const weaponsCount = Math.max(1, (Number(row.energy_hardpoints || 0) + Number(row.balistic_hardpoints || 0)) || 3);
            const missilesCount = Math.max(1, Number(row.missile_hardpoints ?? 2));
            const devicesCount = Math.max(1, Number(row.spec_devices ?? 2));
            const utilitiesCount = Math.max(1, Number(row.spec_utilities ?? 3));
            const vEquips = equipByVessel[vUid] || {};

            let totalDps = 0;
            let totalEnergyUsed = 0;
            let bonusEnergyMax = 0;

            const buildSlotList = (count, baseOffset, prefix, categoryLabel) => {
                const list = [];
                for (let i = 0; i < count; i++) {
                    const dbSlot = baseOffset + i;
                    const eq = vEquips[dbSlot];
                    if (eq) {
                        const sp = mapItemSpecs(eq);
                        totalDps += sp.dps;
                        totalEnergyUsed += sp.energy;
                        if (Number(eq.item_type) === 4 && eq.device_effect_type === 'flat' && Number(eq.target_module_uid) === 4) {
                            bonusEnergyMax += Number(eq.device_effect_value || 0);
                        }
                        list.push({
                            id: `${prefix}:${i}`,
                            db_slot: dbSlot,
                            category: categoryLabel,
                            free: false,
                            item_code: Number(eq.item_code),
                            name: eq.item_name,
                            group_name: eq.group_name || '',
                            image_url: eq.image || null,
                            qty: (baseOffset === 100 || baseOffset === 300) ? Number(eq.amount || 1) : null,
                            ...sp
                        });
                    } else {
                        list.push({
                            id: `${prefix}:${i}`,
                            db_slot: dbSlot,
                            category: categoryLabel,
                            free: true,
                            name: '+ SLOT LIVRE',
                            dps: 0,
                            energy: 0,
                            range: 0
                        });
                    }
                }
                return list;
            };

            const hardpoints = {
                'CANH\u00d5ES': buildSlotList(weaponsCount, 0, 'can', 'CANH\u00d5ES'),
                'M\u00cdSSEIS': buildSlotList(missilesCount, 100, 'mis', 'M\u00cdSSEIS'),
                'DISPOSITIVOS': buildSlotList(devicesCount, 200, 'dev', 'DISPOSITIVOS'),
                'UTILIT\u00c1RIOS': buildSlotList(utilitiesCount, 300, 'uti', 'UTILIT\u00c1RIOS')
            };

            const baseMaxEnergy = Number(row.spec_max_energy || 650);

            return {
                vessel_uid: vUid,
                pilot_uid: Number(row.pilot_uid),
                item_code: Number(row.item_code),
                item_code_formatted: formatItemCode(row.item_code),
                name: String(row.vessel_name).toUpperCase(),
                registry: `Registro #${vUid} \u00b7 item ${formatItemCode(row.item_code)}`,
                selected: isSelected,
                status: isSelected ? 'ATIVA' : (isAtCurrentStation ? 'ATRACADA' : 'EM OUTRA ESTA\u00c7\u00c3O'),
                is_at_current_station: isAtCurrentStation,
                orbit: vOrbit,
                station: vStation,
                location_label: `${orbitLabel} - ${stationLabel}`,
                cargo_capacity: Number(row.cargo_capacity),
                base_price: basePrice,
                damage_percent: damagePercent,
                repair_cost: repairCost,
                integrity: avgIntegrity,
                hull_integrity: integrity,
                hologram_url: hologramUrl,
                image_3d_url: row.image_3d_url || null,
                hardpoints,
                stats: {
                    dps: totalDps,
                    energyUsed: totalEnergyUsed,
                    energyMax: baseMaxEnergy + bonusEnergyMax,
                    mass: Number(row.cargo_capacity || 1000)
                },
                subsystems: [
                    { key: 'integrity', name: 'Integridade do Casco', val: integrity, status: getSubStatus(integrity), repair_cost: calcSubRepairCost(integrity) },
                    { key: 'engine', name: 'Motores de Empuxo', val: engine, status: getSubStatus(engine), repair_cost: calcSubRepairCost(engine) },
                    { key: 'sensors', name: 'Sensores Orbitais', val: sensors, status: getSubStatus(sensors), repair_cost: calcSubRepairCost(sensors) },
                    { key: 'life_support', name: 'Suporte de Vida', val: lifeSupport, status: getSubStatus(lifeSupport), repair_cost: calcSubRepairCost(lifeSupport) },
                    { key: 'inertial_damper', name: 'Amortecedores Inerciais', val: inertialDamper, status: getSubStatus(inertialDamper), repair_cost: calcSubRepairCost(inertialDamper) }
                ]
            };
        });

        // 3. Monta o CATALOGO DE ITENS consolidado para o Loadout:
        //    - Estoque no deposito da estacao (type='hangar')
        //    - Estoque na carga da nave (type='vessel_cargo')
        //    - Estoque no mercado da estacao (somando anuncios de jogadores + estacao, priorizando anuncios de jogadores mais antigos primeiro!)
        const hangarSlots = await conn.query(
            "SELECT item_code, SUM(amount) AS total_amt FROM container_slots WHERE container_uid = ? GROUP BY item_code",
            [hangarContainerUid]
        );
        const hangarStockMap = {};
        for (const r of hangarSlots) {
            hangarStockMap[Number(r.item_code)] = Number(r.total_amt || 0);
        }

        const cargoSlots = await conn.query(
            `SELECT cs.item_code, SUM(cs.amount) AS total_amt
             FROM container_slots cs
             INNER JOIN containers c ON c.container_uid = cs.container_uid
             WHERE c.owner = ? AND c.type = 'vessel_cargo'
             GROUP BY cs.item_code`,
            [pilotUid]
        );
        const cargoStockMap = {};
        for (const r of cargoSlots) {
            cargoStockMap[Number(r.item_code)] = Number(r.total_amt || 0);
        }

        // Busca ofertas do mercado da estacao ordenadas por prioridade:
        // 1o: Anuncios de outros jogadores (owner_pilot_uid > 0 e != pilotUid), do mais antigo (last_update ASC) para o mais recente
        // 2o: Estoque da Estacao (owner_pilot_uid = 0)
        const mktRows = await conn.query(
            `SELECT item_code, owner_pilot_uid, selling_price, stock, last_update
             FROM market_items
             WHERE market_uid = ? AND stock > 0 AND owner_pilot_uid != ?
             ORDER BY (owner_pilot_uid > 0) DESC, last_update ASC, owner_pilot_uid ASC`,
            [marketUid, pilotUid]
        );

        const marketSummaryMap = {};
        for (const mr of mktRows) {
            const code = Number(mr.item_code);
            const st = Number(mr.stock || 0);
            if (st <= 0) continue;
            if (!marketSummaryMap[code]) {
                marketSummaryMap[code] = {
                    total_market_stock: 0,
                    next_buy_price: Math.round(Number(mr.selling_price || 100)),
                    next_owner_pilot_uid: Number(mr.owner_pilot_uid || 0),
                    has_pilot_ads: Number(mr.owner_pilot_uid || 0) > 0
                };
            }
            marketSummaryMap[code].total_market_stock += st;
        }

        const allEquipCatalogRows = await conn.query(
            `SELECT 
                i.item_code,
                i.item_type,
                i.group_code,
                i.name AS item_name,
                i.price AS catalog_price,
                i.image,
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
                us.effect_range AS utility_effect_range
             FROM items i
             LEFT JOIN item_groups ig ON ig.group_code = i.group_code
             LEFT JOIN weapon_specs ws ON ws.item_code = i.item_code
             LEFT JOIN device_specs ds ON ds.item_code = i.item_code
             LEFT JOIN vessel_modules vm ON vm.module_uid = ds.target_module_uid
             LEFT JOIN utility_specs us ON us.item_code = i.item_code
             WHERE i.item_type IN (2, 3, 4, 5)
             ORDER BY i.item_type ASC, i.item_code ASC`
        );

        const catalog = {
            'CANH\u00d5ES': [],
            'M\u00cdSSEIS': [],
            'DISPOSITIVOS': [],
            'UTILIT\u00c1RIOS': []
        };

        for (const r of allEquipCatalogRows) {
            const code = Number(r.item_code);
            const hStock = Number(hangarStockMap[code] || 0);
            const cStock = Number(cargoStockMap[code] || 0);
            const ownedStock = hStock + cStock;
            const mktInfo = marketSummaryMap[code];
            const marketStock = mktInfo ? mktInfo.total_market_stock : 0;

            // Regra solicitada: Nao trazer itens que nao estejam disponiveis no estoque do jogador, nem na carga da nave e nem no estoque da estacao/mercado!
            if (ownedStock <= 0 && marketStock <= 0) {
                continue;
            }

            const sp = mapItemSpecs(r);
            const iType = Number(r.item_type);
            let catKey = 'CANH\u00d5ES';
            if (iType === 3) catKey = 'M\u00cdSSEIS';
            else if (iType === 4) catKey = 'DISPOSITIVOS';
            else if (iType === 5) catKey = 'UTILIT\u00c1RIOS';

            catalog[catKey].push({
                item_code: code,
                item_code_formatted: formatItemCode(code),
                name: r.item_name,
                item_type: iType,
                group_name: r.group_name || '',
                image_url: r.image || null,
                stock: ownedStock,
                hangar_stock: hStock,
                cargo_stock: cStock,
                inStock: ownedStock > 0,
                market_stock: marketStock,
                buy_price: mktInfo ? mktInfo.next_buy_price : Math.round(Number(r.catalog_price || 1000)),
                next_seller_is_pilot: mktInfo ? mktInfo.has_pilot_ads : false,
                ...sp
            });
        }

        return res.json({
            status: "sucesso",
            data: {
                pilot: pilot ? {
                    pilot_uid: Number(pilot.pilot_uid),
                    name: pilot.pilot_name,
                    orbit: pilotOrbit,
                    station: pilotStation,
                    credits: pilotCredits,
                    docked: String(pilot.docked || 'y').toLowerCase() === 'y',
                    location_label: `${(pilot.orbit_name || `\u00d3RBITA ${pilotOrbit}`).toUpperCase()} - ${(pilot.station_name || `ESTA\u00c7\u00c3O ${pilotStation}`).toUpperCase()}`
                } : null,
                vessels,
                catalog
            }
        });
    } catch (err) {
        console.error("[Hangar getPilotFleet Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

const selectActiveVessel = async (req, res) => {
    const { pilot_uid, vessel_uid } = req.body;
    if (!pilot_uid || !vessel_uid) {
        return res.status(400).json({
            status: "erro",
            mensagem: "pilot_uid e vessel_uid s\u00e3o obrigat\u00f3rios."
        });
    }

    let conn;
    try {
        conn = await db.getConnection();

        const pilotRows = await conn.query(
            "SELECT orbit, station FROM pilots WHERE pilot_uid = ? LIMIT 1",
            [pilot_uid]
        );
        if (pilotRows.length === 0) {
            return res.status(404).json({ status: "erro", mensagem: "Piloto n\u00e3o encontrado." });
        }

        const vesselRows = await conn.query(
            "SELECT vessel_uid, orbit, station FROM vessels WHERE vessel_uid = ? AND pilot_uid = ? LIMIT 1",
            [vessel_uid, pilot_uid]
        );
        if (vesselRows.length === 0) {
            return res.status(404).json({ status: "erro", mensagem: "Nave n\u00e3o encontrada para este piloto." });
        }

        const pilot = pilotRows[0];
        const vessel = vesselRows[0];

        if (Number(pilot.orbit) !== Number(vessel.orbit) || Number(pilot.station) !== Number(vessel.station)) {
            return res.status(400).json({
                status: "erro",
                mensagem: "Voc\u00ea precisa estar na mesma esta\u00e7\u00e3o onde esta nave est\u00e1 atracada para ativ\u00e1-la."
            });
        }

        await conn.query("UPDATE vessels SET selected = 'n' WHERE pilot_uid = ?", [pilot_uid]);
        await conn.query("UPDATE vessels SET selected = 'y' WHERE vessel_uid = ? AND pilot_uid = ?", [vessel_uid, pilot_uid]);

        return res.json({
            status: "sucesso",
            mensagem: "Nave ativada com sucesso!",
            active_vessel_uid: Number(vessel_uid)
        });
    } catch (err) {
        console.error("[Hangar selectActiveVessel Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

const repairVessel = async (req, res) => {
    const { pilot_uid, vessel_uid, subsystem_key } = req.body;
    if (!pilot_uid || !vessel_uid) {
        return res.status(400).json({
            status: "erro",
            mensagem: "pilot_uid e vessel_uid s\u00e3o obrigat\u00f3rios."
        });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const pilotRows = await conn.query(
            "SELECT orbit, station FROM pilots WHERE pilot_uid = ? LIMIT 1",
            [pilot_uid]
        );
        if (pilotRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Piloto n\u00e3o encontrado." });
        }

        const vesselRows = await conn.query(
            `SELECT v.*, COALESCE(i.price, 250000) AS base_price, COALESCE(i.name, CONCAT('Nave #', v.vessel_uid)) AS vessel_name
             FROM vessels v
             LEFT JOIN items i ON i.item_code = v.item_code
             WHERE v.vessel_uid = ? AND v.pilot_uid = ?
             LIMIT 1 FOR UPDATE`,
            [vessel_uid, pilot_uid]
        );
        if (vesselRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Nave n\u00e3o encontrada para este piloto." });
        }

        const pilot = pilotRows[0];
        const vessel = vesselRows[0];

        if (Number(pilot.orbit) !== Number(vessel.orbit) || Number(pilot.station) !== Number(vessel.station)) {
            await conn.rollback();
            return res.status(400).json({
                status: "erro",
                mensagem: "A nave precisa estar na mesma esta\u00e7\u00e3o em que voc\u00ea se encontra para realizar reparos."
            });
        }

        const basePrice = Math.round(Number(vessel.base_price || 250000));
        const integrity = Number(vessel.integrity ?? 100);
        const engine = Number(vessel.engine ?? 100);
        const sensors = Number(vessel.sensors ?? 100);
        const lifeSupport = Number(vessel.life_support ?? 100);
        const inertialDamper = Number(vessel.inertial_damper ?? 100);

        const validKeys = ['integrity', 'engine', 'sensors', 'life_support', 'inertial_damper'];
        let repairCost = 0;
        let updateSql = '';
        let repairDescription = '';

        if (subsystem_key && validKeys.includes(subsystem_key)) {
            const currentVal = Number(vessel[subsystem_key] ?? 100);
            if (currentVal >= 100) {
                await conn.rollback();
                return res.status(400).json({ status: "erro", mensagem: "Este subsistema j\u00e1 est\u00e1 em 100%." });
            }
            const subDamage = Math.max(0, 100.0 - currentVal);
            repairCost = Math.round(basePrice * (subDamage / 500.0));
            updateSql = `UPDATE vessels SET ${subsystem_key} = 100 WHERE vessel_uid = ? AND pilot_uid = ?`;
            repairDescription = `Subsistema reparado com sucesso na nave ${vessel.vessel_name}`;
        } else {
            const avgIntegrity = (integrity + engine + sensors + lifeSupport + inertialDamper) / 5.0;
            const damagePercent = Math.max(0, 100.0 - avgIntegrity);
            if (damagePercent <= 0) {
                await conn.rollback();
                return res.status(400).json({ status: "erro", mensagem: "Todos os subsistemas desta nave j\u00e1 est\u00e3o em 100%!" });
            }
            repairCost = Math.round(basePrice * (damagePercent / 100.0));
            updateSql = `UPDATE vessels SET integrity = 100, engine = 100, sensors = 100, life_support = 100, inertial_damper = 100 WHERE vessel_uid = ? AND pilot_uid = ?`;
            repairDescription = `Todos os subsistemas da nave ${vessel.vessel_name} foram 100% reparados!`;
        }

        await conn.query("INSERT IGNORE INTO wallets (wallet_uid, cash, credits) VALUES (0, 0, 999999999)");
        await conn.query("INSERT IGNORE INTO wallets (wallet_uid, cash, credits) VALUES (?, 0, 1000000)", [pilot_uid]);
        const walletRows = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? FOR UPDATE", [pilot_uid]);
        const currentCredits = walletRows.length > 0 ? Number(walletRows[0].credits || 0) : 0;

        if (currentCredits < repairCost) {
            await conn.rollback();
            return res.status(400).json({
                status: "erro",
                mensagem: `Cr\u00e9ditos insuficientes para o reparo! Custo: ${repairCost} CR | Saldo: ${currentCredits} CR.`
            });
        }

        const newCredits = currentCredits - repairCost;
        await conn.query("UPDATE wallets SET credits = ? WHERE wallet_uid = ?", [newCredits, pilot_uid]);
        await conn.query(
            `INSERT INTO wallet_transactions (wallet_from, wallet_to, amount, balance_from_before, balance_from_after, balance_to_before, balance_to_after, operation_type, reference_id)
             VALUES (?, 0, ?, ?, ?, 0, 0, 'vessel_repair', ?)`,
            [pilot_uid, repairCost, currentCredits, newCredits, vessel_uid]
        );

        await conn.query(updateSql, [vessel_uid, pilot_uid]);
        await conn.commit();

        return res.json({
            status: "sucesso",
            mensagem: `${repairDescription} (-${repairCost} CR)`,
            data: {
                vessel_uid: Number(vessel_uid),
                repair_cost: repairCost,
                new_credits: newCredits
            }
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error("[Hangar repairVessel Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

// Equipa (ou Compra + Equipa) um item em um slot de Hardpoint da nave
const equipVesselSlot = async (req, res) => {
    const { pilot_uid, vessel_uid, db_slot, item_code } = req.body;
    if (!pilot_uid || !vessel_uid || db_slot === undefined || !item_code) {
        return res.status(400).json({
            status: "erro",
            mensagem: "pilot_uid, vessel_uid, db_slot e item_code s\u00e3o obrigat\u00f3rios."
        });
    }

    const slotNum = Number(db_slot);
    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const pilotRows = await conn.query("SELECT orbit, station FROM pilots WHERE pilot_uid = ? LIMIT 1", [pilot_uid]);
        if (pilotRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Piloto n\u00e3o encontrado." });
        }
        const pilotOrbit = Number(pilotRows[0].orbit || 2);
        const pilotStation = Number(pilotRows[0].station || 1);

        const vesselRows = await conn.query(
            "SELECT vessel_uid, orbit, station FROM vessels WHERE vessel_uid = ? AND pilot_uid = ? LIMIT 1 FOR UPDATE",
            [vessel_uid, pilot_uid]
        );
        if (vesselRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Nave n\u00e3o encontrada." });
        }
        if (Number(vesselRows[0].orbit) !== pilotOrbit || Number(vesselRows[0].station) !== pilotStation) {
            await conn.rollback();
            return res.status(400).json({
                status: "erro",
                mensagem: "A nave precisa estar na mesma esta\u00e7\u00e3o para modificar o Loadout."
            });
        }

        const itemRows = await conn.query("SELECT item_code, name, item_type FROM items WHERE item_code = ? LIMIT 1", [item_code]);
        if (itemRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Item n\u00e3o encontrado." });
        }
        const itemInfo = itemRows[0];
        const iType = Number(itemInfo.item_type);

        let eqType = 'weapon';
        if (iType === 3 || (slotNum >= 100 && slotNum < 200)) eqType = 'missile';
        else if (iType === 4 || (slotNum >= 200 && slotNum < 300)) eqType = 'device';
        else if (iType === 5 || (slotNum >= 300 && slotNum < 400)) eqType = 'utility';

        const { marketUid, hangarContainerUid } = await ensureStationContainersAndMarket(conn, pilot_uid, pilotOrbit, pilotStation);

        // 1. Verifica se o jogador ja tem o item no deposito da estacao (hangar) ou na carga da nave (vessel_cargo)
        const ownedSlots = await conn.query(
            `SELECT cs.container_uid, cs.slot, cs.amount, c.type
             FROM container_slots cs
             INNER JOIN containers c ON c.container_uid = cs.container_uid
             WHERE c.owner = ? AND ((c.type = 'hangar' AND c.storage = ?) OR c.type = 'vessel_cargo')
               AND cs.item_code = ? AND cs.amount > 0
             ORDER BY (c.type = 'hangar') DESC, cs.slot ASC
             FOR UPDATE`,
            [pilot_uid, pilotStation, item_code]
        );

        let boughtFromMarket = false;
        let buyCost = 0;
        let sellerLabel = '';

        if (ownedSlots.length > 0) {
            // Consome 1 unidade do estoque do proprio jogador
            const targetSlot = ownedSlots[0];
            if (Number(targetSlot.amount) <= 1) {
                await conn.query("DELETE FROM container_slots WHERE container_uid = ? AND slot = ?", [targetSlot.container_uid, targetSlot.slot]);
            } else {
                await conn.query("UPDATE container_slots SET amount = amount - 1 WHERE container_uid = ? AND slot = ?", [targetSlot.container_uid, targetSlot.slot]);
            }
        } else {
            // Nao tem no estoque do jogador -> Compra automaticamente 1 unidade no mercado da estacao!
            // Regra: Sempre comprar primeiro de anuncio de jogador (do mais antigo para o mais recente) antes de comprar da estacao!
            const mktOffers = await conn.query(
                `SELECT mi.*, p.pilot AS seller_name
                 FROM market_items mi
                 LEFT JOIN pilots p ON p.pilot_uid = mi.owner_pilot_uid
                 WHERE mi.market_uid = ? AND mi.item_code = ? AND mi.stock > 0 AND mi.owner_pilot_uid != ?
                 ORDER BY (mi.owner_pilot_uid > 0) DESC, mi.last_update ASC, mi.owner_pilot_uid ASC
                 LIMIT 1 FOR UPDATE`,
                [marketUid, item_code, pilot_uid]
            );

            if (mktOffers.length === 0) {
                await conn.rollback();
                return res.status(400).json({
                    status: "erro",
                    mensagem: "Este item n\u00e3o est\u00e1 dispon\u00edvel nem no seu estoque nem no mercado desta esta\u00e7\u00e3o."
                });
            }

            const offer = mktOffers[0];
            const ownerUid = Number(offer.owner_pilot_uid || 0);
            buyCost = Math.round(Number(offer.selling_price || 100));
            sellerLabel = ownerUid > 0 ? ` do piloto ${offer.seller_name || '#' + ownerUid}` : ' da Esta\u00e7\u00e3o';

            const wRows = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? FOR UPDATE", [pilot_uid]);
            const buyerBefore = wRows.length > 0 ? Number(wRows[0].credits || 0) : 0;

            if (buyerBefore < buyCost) {
                await conn.rollback();
                return res.status(400).json({
                    status: "erro",
                    mensagem: `Cr\u00e9ditos insuficientes para comprar ${itemInfo.name}! Necess\u00e1rio: ${buyCost} CR | Saldo: ${buyerBefore} CR.`
                });
            }

            const buyerAfter = buyerBefore - buyCost;
            await conn.query("UPDATE wallets SET credits = ? WHERE wallet_uid = ?", [buyerAfter, pilot_uid]);

            let sellerBefore = 0;
            let sellerAfter = 0;
            if (ownerUid > 0) {
                await conn.query("INSERT IGNORE INTO wallets (wallet_uid, cash, credits) VALUES (?, 0, 1000000)", [ownerUid]);
                const sw = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? FOR UPDATE", [ownerUid]);
                sellerBefore = sw.length > 0 ? Number(sw[0].credits || 0) : 0;
                sellerAfter = sellerBefore + buyCost;
                await conn.query("UPDATE wallets SET credits = ? WHERE wallet_uid = ?", [sellerAfter, ownerUid]);
            }

            await conn.query(
                `INSERT INTO wallet_transactions (wallet_from, wallet_to, amount, balance_from_before, balance_from_after, balance_to_before, balance_to_after, operation_type, reference_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [pilot_uid, ownerUid, buyCost, buyerBefore, buyerAfter, sellerBefore, sellerAfter, ownerUid > 0 ? 'loadout_p2p_buy' : 'loadout_station_buy', item_code]
            );

            const newStock = Number(offer.stock) - 1;
            if (ownerUid > 0 && newStock <= 0) {
                await conn.query("DELETE FROM market_items WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ?", [marketUid, item_code, ownerUid]);
            } else {
                await conn.query("UPDATE market_items SET stock = ? WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = ?", [newStock, marketUid, item_code, ownerUid]);
            }

            boughtFromMarket = true;
        }

        // 2. Se ja havia um equipamento instalado neste slot, devolve-o para o deposito da estacao do jogador
        const existingEq = await conn.query(
            "SELECT item_code, amount FROM vessel_equipments WHERE vessel_uid = ? AND slot = ? FOR UPDATE",
            [vessel_uid, slotNum]
        );
        if (existingEq.length > 0) {
            const oldItemCode = Number(existingEq[0].item_code);
            const oldAmt = Math.max(1, Number(existingEq[0].amount || 1));
            const existingHangarSlot = await conn.query(
                "SELECT slot FROM container_slots WHERE container_uid = ? AND item_code = ? LIMIT 1 FOR UPDATE",
                [hangarContainerUid, oldItemCode]
            );
            if (existingHangarSlot.length > 0) {
                await conn.query(
                    "UPDATE container_slots SET amount = amount + ? WHERE container_uid = ? AND slot = ?",
                    [oldAmt, hangarContainerUid, existingHangarSlot[0].slot]
                );
            } else {
                const maxSlotRow = await conn.query(
                    "SELECT COALESCE(MAX(slot), 0) AS max_slot FROM container_slots WHERE container_uid = ?",
                    [hangarContainerUid]
                );
                const nextSlot = Number(maxSlotRow[0].max_slot || 0) + 1;
                await conn.query(
                    "INSERT INTO container_slots (container_uid, slot, item_code, amount) VALUES (?, ?, ?, ?)",
                    [hangarContainerUid, nextSlot, oldItemCode, oldAmt]
                );
            }
        }

        // 3. Instala o novo item no slot da nave
        await conn.query(
            `INSERT INTO vessel_equipments (vessel_uid, slot, item_code, type, amount)
             VALUES (?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE item_code = VALUES(item_code), type = VALUES(type), amount = 1`,
            [vessel_uid, slotNum, item_code, eqType]
        );

        await conn.commit();

        return res.json({
            status: "sucesso",
            mensagem: boughtFromMarket
                ? `${itemInfo.name} comprado${sellerLabel} (-${buyCost} CR) e instalado na nave!`
                : `${itemInfo.name} equipado na nave com sucesso!`,
            data: {
                bought_from_market: boughtFromMarket,
                buy_cost: buyCost
            }
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error("[Hangar equipVesselSlot Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

// Desequipa um slot da nave e devolve o item ao deposito da estacao
const unequipVesselSlot = async (req, res) => {
    const { pilot_uid, vessel_uid, db_slot } = req.body;
    if (!pilot_uid || !vessel_uid || db_slot === undefined) {
        return res.status(400).json({
            status: "erro",
            mensagem: "pilot_uid, vessel_uid e db_slot s\u00e3o obrigat\u00f3rios."
        });
    }

    const slotNum = Number(db_slot);
    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const pilotRows = await conn.query("SELECT orbit, station FROM pilots WHERE pilot_uid = ? LIMIT 1", [pilot_uid]);
        if (pilotRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Piloto n\u00e3o encontrado." });
        }
        const pilotOrbit = Number(pilotRows[0].orbit || 2);
        const pilotStation = Number(pilotRows[0].station || 1);

        const vesselRows = await conn.query(
            "SELECT vessel_uid, orbit, station FROM vessels WHERE vessel_uid = ? AND pilot_uid = ? LIMIT 1 FOR UPDATE",
            [vessel_uid, pilot_uid]
        );
        if (vesselRows.length === 0 || Number(vesselRows[0].orbit) !== pilotOrbit || Number(vesselRows[0].station) !== pilotStation) {
            await conn.rollback();
            return res.status(400).json({
                status: "erro",
                mensagem: "A nave precisa estar na mesma esta\u00e7\u00e3o para desequipar itens."
            });
        }

        const existingEq = await conn.query(
            `SELECT ve.item_code, ve.amount, i.name AS item_name
             FROM vessel_equipments ve
             INNER JOIN items i ON i.item_code = ve.item_code
             WHERE ve.vessel_uid = ? AND ve.slot = ? FOR UPDATE`,
            [vessel_uid, slotNum]
        );
        if (existingEq.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Este slot j\u00e1 est\u00e1 vazio." });
        }

        const oldItemCode = Number(existingEq[0].item_code);
        const oldAmt = Math.max(1, Number(existingEq[0].amount || 1));
        const itemName = existingEq[0].item_name;

        const { hangarContainerUid } = await ensureStationContainersAndMarket(conn, pilot_uid, pilotOrbit, pilotStation);

        await conn.query("DELETE FROM vessel_equipments WHERE vessel_uid = ? AND slot = ?", [vessel_uid, slotNum]);

        const existingHangarSlot = await conn.query(
            "SELECT slot FROM container_slots WHERE container_uid = ? AND item_code = ? LIMIT 1 FOR UPDATE",
            [hangarContainerUid, oldItemCode]
        );
        if (existingHangarSlot.length > 0) {
            await conn.query(
                "UPDATE container_slots SET amount = amount + ? WHERE container_uid = ? AND slot = ?",
                [oldAmt, hangarContainerUid, existingHangarSlot[0].slot]
            );
        } else {
            const maxSlotRow = await conn.query(
                "SELECT COALESCE(MAX(slot), 0) AS max_slot FROM container_slots WHERE container_uid = ?",
                [hangarContainerUid]
            );
            const nextSlot = Number(maxSlotRow[0].max_slot || 0) + 1;
            await conn.query(
                "INSERT INTO container_slots (container_uid, slot, item_code, amount) VALUES (?, ?, ?, ?)",
                [hangarContainerUid, nextSlot, oldItemCode, oldAmt]
            );
        }

        await conn.commit();

        return res.json({
            status: "sucesso",
            mensagem: `${itemName} removido da nave e guardado no seu dep\u00f3sito da esta\u00e7\u00e3o!`
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error("[Hangar unequipVesselSlot Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

// Helper para consumir quantidade de um container (somando se estiver espalhado em multiplos slots)
async function removeItemFromContainer(conn, containerUid, itemCode, qtyToRemove) {
    const slots = await conn.query(
        "SELECT slot, amount FROM container_slots WHERE container_uid = ? AND item_code = ? AND amount > 0 ORDER BY slot ASC FOR UPDATE",
        [containerUid, itemCode]
    );
    const totalAvailable = slots.reduce((acc, s) => acc + Number(s.amount || 0), 0);
    if (totalAvailable < qtyToRemove) {
        return { ok: false, available: totalAvailable };
    }
    let remaining = qtyToRemove;
    for (const s of slots) {
        if (remaining <= 0) break;
        const amt = Number(s.amount || 0);
        if (amt <= remaining) {
            await conn.query("DELETE FROM container_slots WHERE container_uid = ? AND slot = ?", [containerUid, s.slot]);
            remaining -= amt;
        } else {
            await conn.query("UPDATE container_slots SET amount = amount - ? WHERE container_uid = ? AND slot = ?", [remaining, containerUid, s.slot]);
            remaining = 0;
        }
    }
    return { ok: true, available: totalAvailable };
}

// Helper para adicionar quantidade a um container
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
}

async function syncContainerVolume(conn, containerUid) {
    const rows = await conn.query(
        `SELECT COALESCE(SUM(cs.amount * GREATEST(1, COALESCE(i.volume, 1))), 0) AS used_vol
         FROM container_slots cs
         INNER JOIN items i ON i.item_code = cs.item_code
         WHERE cs.container_uid = ? AND cs.amount > 0`,
        [containerUid]
    );
    const usedVol = Number(rows[0]?.used_vol || 0);
    await conn.query("UPDATE containers SET current_volume = ? WHERE container_uid = ?", [usedVol, containerUid]);
    return usedVol;
}

const getPilotInventory = async (req, res) => {
    const pilotUid = req.params.pilotUid || req.query.pilot_uid;
    if (!pilotUid) {
        return res.status(400).json({ status: "erro", mensagem: "Par\u00e2metro pilot_uid \u00e9 obrigat\u00f3rio." });
    }

    let conn;
    try {
        conn = await db.getConnection();

        const pilotRows = await conn.query(
            `SELECT p.pilot_uid, p.orbit, p.station, s.name AS orbit_name, st.name AS station_name
             FROM pilots p
             LEFT JOIN orbits s ON s.id = p.orbit
             LEFT JOIN orbit_stations st ON st.id = p.station
             WHERE p.pilot_uid = ? LIMIT 1`,
            [pilotUid]
        );
        const pilot = pilotRows.length > 0 ? pilotRows[0] : null;
        const pilotOrbit = pilot ? Number(pilot.orbit || 2) : 2;
        const pilotStation = pilot ? Number(pilot.station || 1) : 1;

        const { hangarContainerUid } = await ensureStationContainersAndMarket(conn, pilotUid, pilotOrbit, pilotStation);

        const hangarContRows = await conn.query(
            "SELECT container_uid, max_volume, current_volume FROM containers WHERE container_uid = ? LIMIT 1",
            [hangarContainerUid]
        );
        const maxStationVolume = Number(hangarContRows[0]?.max_volume || 50000);

        const stationItemRows = await conn.query(
            `SELECT 
                cs.item_code,
                SUM(cs.amount) AS total_amount,
                i.name AS item_name,
                i.item_type,
                GREATEST(1, COALESCE(i.volume, 1)) AS unit_volume,
                i.image,
                ig.name AS group_name
             FROM container_slots cs
             INNER JOIN items i ON i.item_code = cs.item_code
             LEFT JOIN item_groups ig ON ig.group_code = i.group_code
             WHERE cs.container_uid = ? AND cs.amount > 0 AND i.item_type IN (1, 2, 3, 4, 5)
             GROUP BY cs.item_code
             ORDER BY i.item_type ASC, i.item_code ASC`,
            [hangarContainerUid]
        );

        let usedStationVolume = 0;
        const stationItems = stationItemRows.map(r => {
            const amt = Number(r.total_amount || 0);
            const unitVol = Number(r.unit_volume || 1);
            const totalVol = amt * unitVol;
            usedStationVolume += totalVol;
            return {
                item_code: Number(r.item_code),
                item_code_formatted: formatItemCode(r.item_code),
                name: r.item_name,
                item_type: Number(r.item_type),
                group_name: r.group_name || '',
                unit_volume: unitVol,
                total_volume: totalVol,
                amount: amt,
                image_url: r.image || null
            };
        });
        await conn.query("UPDATE containers SET current_volume = ? WHERE container_uid = ?", [usedStationVolume, hangarContainerUid]);

        // Naves do piloto que estao na mesma estacao
        const vesselRows = await conn.query(
            `SELECT 
                v.vessel_uid,
                v.pilot_uid,
                v.item_code,
                v.selected,
                v.orbit,
                v.station,
                v.cargo_capacity,
                COALESCE(i.name, CONCAT('Nave #', v.vessel_uid)) AS vessel_name,
                COALESCE(i.volume, 0) AS ship_volume,
                ii.image_2d_url
             FROM vessels v
             LEFT JOIN items i ON i.item_code = v.item_code
             LEFT JOIN item_images ii ON ii.item_code = v.item_code
             WHERE v.pilot_uid = ? AND v.orbit = ? AND v.station = ?
             ORDER BY (v.selected = 'y') DESC, v.vessel_uid ASC`,
            [pilotUid, pilotOrbit, pilotStation]
        );

        const vessels = [];
        for (const v of vesselRows) {
            const vUid = Number(v.vessel_uid);
            const shipVol = Number(v.ship_volume || 0);
            const maxCargoVol = Number(v.cargo_capacity) > 0
                ? Number(v.cargo_capacity)
                : Math.ceil(shipVol * 0.30);

            if (Number(v.cargo_capacity) !== maxCargoVol) {
                await conn.query("UPDATE vessels SET cargo_capacity = ? WHERE vessel_uid = ?", [maxCargoVol, vUid]);
            }

            // Garante o container de carga da nave
            let vcRows = await conn.query(
                "SELECT container_uid, max_volume FROM containers WHERE storage = ? AND type = 'vessel_cargo' LIMIT 1",
                [vUid]
            );
            let vesselContainerUid;
            if (vcRows.length === 0) {
                const ins = await conn.query(
                    "INSERT INTO containers (owner, storage, type, max_volume, current_volume, protected) VALUES (?, ?, 'vessel_cargo', ?, 0, 'n')",
                    [pilotUid, vUid, maxCargoVol]
                );
                vesselContainerUid = Number(ins.insertId);
            } else {
                vesselContainerUid = Number(vcRows[0].container_uid);
                if (Number(vcRows[0].max_volume) !== maxCargoVol) {
                    await conn.query("UPDATE containers SET owner = ?, max_volume = ? WHERE container_uid = ?", [pilotUid, maxCargoVol, vesselContainerUid]);
                }
            }

            const cargoItemRows = await conn.query(
                `SELECT 
                    cs.item_code,
                    SUM(cs.amount) AS total_amount,
                    i.name AS item_name,
                    i.item_type,
                    GREATEST(1, COALESCE(i.volume, 1)) AS unit_volume,
                    i.image,
                    ig.name AS group_name
                 FROM container_slots cs
                 INNER JOIN items i ON i.item_code = cs.item_code
                 LEFT JOIN item_groups ig ON ig.group_code = i.group_code
                 WHERE cs.container_uid = ? AND cs.amount > 0 AND i.item_type IN (1, 2, 3, 4, 5)
                 GROUP BY cs.item_code
                 ORDER BY i.item_type ASC, i.item_code ASC`,
                [vesselContainerUid]
            );

            let usedCargoVol = 0;
            const cargoItems = cargoItemRows.map(r => {
                const amt = Number(r.total_amount || 0);
                const unitVol = Number(r.unit_volume || 1);
                const totalVol = amt * unitVol;
                usedCargoVol += totalVol;
                return {
                    item_code: Number(r.item_code),
                    item_code_formatted: formatItemCode(r.item_code),
                    name: r.item_name,
                    item_type: Number(r.item_type),
                    group_name: r.group_name || '',
                    unit_volume: unitVol,
                    total_volume: totalVol,
                    amount: amt,
                    image_url: r.image || null
                };
            });
            await conn.query("UPDATE containers SET current_volume = ? WHERE container_uid = ?", [usedCargoVol, vesselContainerUid]);

            let hologramUrl = null;
            if (v.image_2d_url && String(v.image_2d_url).trim() !== '') {
                const rawPath = String(v.image_2d_url).trim();
                if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
                    hologramUrl = rawPath;
                } else {
                    let fileName = rawPath.split(/[\\/]/).pop();
                    if (fileName) {
                        fileName = fileName.replace(/\.svg$/i, '.png');
                        hologramUrl = `/hologramas/${encodeURIComponent(fileName)}`;
                    }
                }
            }

            const isSelected = String(v.selected || 'n').toLowerCase() === 'y';

            vessels.push({
                vessel_uid: vUid,
                item_code: Number(v.item_code),
                name: String(v.vessel_name).toUpperCase(),
                registry: `Registro #${vUid} \u00b7 item ${formatItemCode(v.item_code)}`,
                selected: isSelected,
                status: isSelected ? 'ATIVA' : 'ATRACADA',
                hologram_url: hologramUrl,
                ship_volume: shipVol,
                max_cargo_volume: maxCargoVol,
                used_cargo_volume: usedCargoVol,
                available_cargo_volume: Math.max(0, maxCargoVol - usedCargoVol),
                cargo_items: cargoItems
            });
        }

        return res.json({
            status: "sucesso",
            data: {
                station: {
                    station_id: pilotStation,
                    station_name: (pilot?.station_name || `ESTA\u00c7\u00c3O ${pilotStation}`).toUpperCase(),
                    max_volume: maxStationVolume,
                    used_volume: usedStationVolume,
                    available_volume: Math.max(0, maxStationVolume - usedStationVolume),
                    items: stationItems
                },
                vessels
            }
        });
    } catch (err) {
        console.error("[Hangar getPilotInventory Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

const transferCargo = async (req, res) => {
    const { pilot_uid, vessel_uid, item_code, quantity, direction } = req.body;
    const qty = Math.floor(Number(quantity || 0));
    if (!pilot_uid || !vessel_uid || !item_code || qty <= 0 || !['TO_SHIP', 'TO_STATION'].includes(direction)) {
        return res.status(400).json({
            status: "erro",
            mensagem: "Par\u00e2metros inv\u00e1lidos para transfer\u00eancia de carga."
        });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        const pilotRows = await conn.query("SELECT orbit, station FROM pilots WHERE pilot_uid = ? LIMIT 1", [pilot_uid]);
        if (pilotRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Piloto n\u00e3o encontrado." });
        }
        const pilotOrbit = Number(pilotRows[0].orbit || 2);
        const pilotStation = Number(pilotRows[0].station || 1);

        const vesselRows = await conn.query(
            `SELECT v.vessel_uid, v.orbit, v.station, v.cargo_capacity, COALESCE(i.volume, 0) AS ship_volume, COALESCE(i.name, 'Nave') AS vessel_name
             FROM vessels v
             LEFT JOIN items i ON i.item_code = v.item_code
             WHERE v.vessel_uid = ? AND v.pilot_uid = ? LIMIT 1 FOR UPDATE`,
            [vessel_uid, pilot_uid]
        );
        if (vesselRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Nave n\u00e3o encontrada." });
        }
        const vessel = vesselRows[0];
        if (Number(vessel.orbit) !== pilotOrbit || Number(vessel.station) !== pilotStation) {
            await conn.rollback();
            return res.status(400).json({
                status: "erro",
                mensagem: "A nave precisa estar atracada na esta\u00e7\u00e3o atual para transferir carga."
            });
        }

        const itemRows = await conn.query(
            "SELECT item_code, name, item_type, GREATEST(1, COALESCE(volume, 1)) AS unit_volume FROM items WHERE item_code = ? LIMIT 1",
            [item_code]
        );
        if (itemRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Item n\u00e3o encontrado." });
        }
        const item = itemRows[0];
        const unitVol = Number(item.unit_volume || 1);
        const moveVolume = unitVol * qty;

        const { hangarContainerUid } = await ensureStationContainersAndMarket(conn, pilot_uid, pilotOrbit, pilotStation);
        const hangarContRows = await conn.query(
            "SELECT container_uid, max_volume FROM containers WHERE container_uid = ? FOR UPDATE",
            [hangarContainerUid]
        );
        const maxStationVolume = Number(hangarContRows[0]?.max_volume || 50000);
        const usedStationVolume = await syncContainerVolume(conn, hangarContainerUid);

        const maxShipCargoVolume = Number(vessel.cargo_capacity) > 0
            ? Number(vessel.cargo_capacity)
            : Math.ceil(Number(vessel.ship_volume || 0) * 0.30);

        let vcRows = await conn.query(
            "SELECT container_uid FROM containers WHERE storage = ? AND type = 'vessel_cargo' LIMIT 1 FOR UPDATE",
            [vessel_uid]
        );
        let vesselContainerUid;
        if (vcRows.length === 0) {
            const ins = await conn.query(
                "INSERT INTO containers (owner, storage, type, max_volume, current_volume, protected) VALUES (?, ?, 'vessel_cargo', ?, 0, 'n')",
                [pilot_uid, vessel_uid, maxShipCargoVolume]
            );
            vesselContainerUid = Number(ins.insertId);
        } else {
            vesselContainerUid = Number(vcRows[0].container_uid);
        }
        const usedShipCargoVolume = await syncContainerVolume(conn, vesselContainerUid);

        if (direction === 'TO_SHIP') {
            const availableShipVol = Math.max(0, maxShipCargoVolume - usedShipCargoVolume);
            if (moveVolume > availableShipVol) {
                await conn.rollback();
                return res.status(400).json({
                    status: "erro",
                    mensagem: `Espa\u00e7o insuficiente na \u00e1rea de carga da nave ${vessel.vessel_name}! Necess\u00e1rio: ${moveVolume} m\u00b3 | Dispon\u00edvel: ${availableShipVol} m\u00b3.`
                });
            }

            const rem = await removeItemFromContainer(conn, hangarContainerUid, item_code, qty);
            if (!rem.ok) {
                await conn.rollback();
                return res.status(400).json({
                    status: "erro",
                    mensagem: `Quantidade insuficiente no dep\u00f3sito da esta\u00e7\u00e3o (dispon\u00edvel: ${rem.available}).`
                });
            }

            await addItemToContainer(conn, vesselContainerUid, item_code, qty);
        } else {
            const availableStationVol = Math.max(0, maxStationVolume - usedStationVolume);
            if (moveVolume > availableStationVol) {
                await conn.rollback();
                return res.status(400).json({
                    status: "erro",
                    mensagem: `Espa\u00e7o insuficiente no dep\u00f3sito da esta\u00e7\u00e3o! Necess\u00e1rio: ${moveVolume} m\u00b3 | Dispon\u00edvel: ${availableStationVol} m\u00b3.`
                });
            }

            const rem = await removeItemFromContainer(conn, vesselContainerUid, item_code, qty);
            if (!rem.ok) {
                await conn.rollback();
                return res.status(400).json({
                    status: "erro",
                    mensagem: `Quantidade insuficiente na carga da nave (dispon\u00edvel: ${rem.available}).`
                });
            }

            await addItemToContainer(conn, hangarContainerUid, item_code, qty);
        }

        const newStationVol = await syncContainerVolume(conn, hangarContainerUid);
        const newShipVol = await syncContainerVolume(conn, vesselContainerUid);

        await conn.commit();

        return res.json({
            status: "sucesso",
            mensagem: direction === 'TO_SHIP'
                ? `${qty}x ${item.name} (${moveVolume} m\u00b3) transferido(s) PARA A NAVE ${vessel.vessel_name}!`
                : `${qty}x ${item.name} (${moveVolume} m\u00b3) transferido(s) PARA A ESTA\u00c7\u00c3O!`,
            data: {
                used_station_volume: newStationVol,
                used_ship_volume: newShipVol
            }
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error("[Hangar transferCargo Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

module.exports = {
    getPilotFleet,
    selectActiveVessel,
    repairVessel,
    equipVesselSlot,
    unequipVesselSlot,
    getPilotInventory,
    transferCargo
};