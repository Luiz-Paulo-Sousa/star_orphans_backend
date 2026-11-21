const db = require('../config/database');

const formatItemCode = (code) => {
    const str = String(code || '');
    if (str.length === 8) {
        return `${str.slice(0, 2)}.${str.slice(2, 5)}.${str.slice(5)}`;
    }
    return str;
};

const buildVesselHardpointsAndStats = (vesselUid, itemCode, cargoCapacity, vsp, eqList = []) => {
    const energyHp = Number(vsp?.energy_hardpoints || 0);
    const balisticHp = Number(vsp?.balistic_hardpoints || 0);
    const totalWeapons = Math.max(1, energyHp + balisticHp);
    const totalMissiles = Number(vsp?.missile_hardpoints || 0);
    const totalDevices = Number(vsp?.devices || 0);
    const totalUtilities = Number(vsp?.utilities || 0);
    const maxEnergy = Number(vsp?.max_energy || 650);

    const eqBySlot = new Map();
    for (const eq of eqList) {
        eqBySlot.set(Number(eq.slot), eq);
    }

    let totalDps = 0;
    let totalEnergyUsed = 0;

    const buildCategorySlots = (category, baseSlot, count, idPrefix) => {
        let maxSlot = baseSlot + count - 1;
        for (const [s] of eqBySlot.entries()) {
            if (s >= baseSlot && s < baseSlot + 100) {
                if (s > maxSlot) maxSlot = s;
            }
        }
        if (count === 0 && maxSlot < baseSlot) {
            return [];
        }

        const slots = [];
        for (let s = baseSlot; s <= maxSlot; s++) {
            const eq = eqBySlot.get(s);
            if (eq) {
                let slotDps = 0;
                let slotEnergy = 0;
                let slotRange = 0;
                let targetMod = null;
                let effVal = null;
                let uType = null;
                let cooldown = null;

                if (category === 'CANHÕES' || category === 'MÍSSEIS') {
                    slotDps = Math.round(Number(eq.damage_per_second || 0));
                    slotEnergy = Math.round(Number(eq.weapon_energy || 0));
                    slotRange = Math.round(Number(eq.fire_range || 0));
                    totalDps += slotDps;
                    totalEnergyUsed += slotEnergy;
                } else if (category === 'DISPOSITIVOS') {
                    slotEnergy = Math.round(Number(eq.device_energy || 0));
                    targetMod = eq.target_module_name || 'Sistema';
                    effVal = eq.device_effect_type === 'percent'
                        ? `+${eq.device_effect_value}%`
                        : `+${eq.device_effect_value} MW`;
                    totalEnergyUsed += slotEnergy;
                } else if (category === 'UTILITÁRIOS') {
                    slotEnergy = Math.round(Number(eq.utility_energy || 0));
                    uType = eq.usage_type === 'rechargeable' ? 'Recarregável' : 'Consumível';
                    cooldown = `${eq.cooldown_seconds || 0}s`;
                    effVal = `+${eq.utility_effect_value || 0}`;
                    totalEnergyUsed += slotEnergy;
                }

                slots.push({
                    id: `${idPrefix}_${vesselUid}_${s}`,
                    db_slot: s,
                    name: eq.name,
                    free: false,
                    image_url: eq.image_url || null,
                    dps: slotDps,
                    energy: slotEnergy,
                    range: slotRange,
                    target_module: targetMod,
                    effect_value: effVal,
                    usage_type: uType,
                    cooldown: cooldown,
                    qty: (category === 'MÍSSEIS' || category === 'UTILITÁRIOS') ? Number(eq.amount || 1) : null,
                    item_code: Number(eq.item_code)
                });
            } else {
                slots.push({
                    id: `${idPrefix}_${vesselUid}_${s}`,
                    db_slot: s,
                    name: 'SLOT VAZIO',
                    free: true,
                    image_url: null,
                    dps: 0,
                    energy: 0,
                    range: 0,
                    target_module: null,
                    effect_value: null,
                    usage_type: null,
                    cooldown: null,
                    qty: null,
                    item_code: null
                });
            }
        }
        return slots;
    };

    const hardpoints = {
        'CANHÕES': buildCategorySlots('CANHÕES', 0, totalWeapons, 'hp'),
        'MÍSSEIS': buildCategorySlots('MÍSSEIS', 100, totalMissiles, 'ms'),
        'DISPOSITIVOS': buildCategorySlots('DISPOSITIVOS', 200, totalDevices, 'dev'),
        'UTILITÁRIOS': buildCategorySlots('UTILITÁRIOS', 300, totalUtilities, 'ut')
    };

    const mass = Number(((cargoCapacity || 1000) / 50.0).toFixed(1));

    return {
        hardpoints,
        stats: {
            dps: totalDps,
            energyUsed: totalEnergyUsed,
            energyMax: maxEnergy,
            mass: mass
        }
    };
};

const getPilotFleet = async (req, res) => {
    const pilotUid = req.params.pilotUid || req.query.pilot_uid;
    if (!pilotUid) {
        return res.status(400).json({
            status: "erro",
            mensagem: "Parâmetro pilot_uid é obrigatório."
        });
    }

    let conn;
    try {
        conn = await db.getConnection();

        // 1. Obtém a localização atual do piloto (orbit e station) e saldo de créditos
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
        const pilotOrbit = pilot ? Number(pilot.orbit) : null;
        const pilotStation = pilot ? Number(pilot.station) : null;
        const pilotCredits = pilot ? Number(pilot.credits || 0) : 0;

        // 2. Obtém as naves do piloto atracadas na estação atual (ou todas caso query all=true)
        const allStations = req.query.all === 'true' || req.query.all_stations === 'true';
        let vesselQuery = `SELECT 
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
                i.image,
                s.name AS orbit_name,
                st.name AS station_name
            FROM vessels v
            LEFT JOIN items i ON i.item_code = v.item_code
            LEFT JOIN orbits s ON s.id = v.orbit
            LEFT JOIN orbit_stations st ON st.id = v.station
            WHERE v.pilot_uid = ?`;
        const vesselParams = [pilotUid];

        if (!allStations && pilotOrbit !== null && pilotStation !== null) {
            vesselQuery += ` AND v.orbit = ? AND v.station = ?`;
            vesselParams.push(pilotOrbit, pilotStation);
        }

        vesselQuery += ` ORDER BY (v.selected = 'y') DESC, v.vessel_uid ASC`;
        const vesselRows = await conn.query(vesselQuery, vesselParams);

        const vesselUids = vesselRows.map(r => Number(r.vessel_uid));
        const vesselItemCodes = [...new Set(vesselRows.map(r => Number(r.item_code)))];

        // 3. Obtém especificações de naves em lote
        let specsRows = [];
        if (vesselItemCodes.length > 0) {
            specsRows = await conn.query(
                "SELECT * FROM vessel_specs WHERE item_code IN (?)",
                [vesselItemCodes]
            );
        }
        const specsMap = new Map();
        for (const s of specsRows) {
            specsMap.set(Number(s.item_code), s);
        }

        // 4. Obtém todos os equipamentos instalados nas naves do piloto
        let equipRows = [];
        if (vesselUids.length > 0) {
            equipRows = await conn.query(
                `SELECT 
                    ve.vessel_uid,
                    ve.slot,
                    ve.item_code,
                    ve.type,
                    ve.amount,
                    i.name,
                    i.item_type,
                    i.image AS image_url,
                    ws.damage_per_second,
                    ws.energy_consumption AS weapon_energy,
                    ws.fire_range,
                    ds.energy_consumption AS device_energy,
                    ds.effect_value AS device_effect_value,
                    ds.effect_type AS device_effect_type,
                    vm.name AS target_module_name,
                    us.usage_type,
                    us.energy_consumption AS utility_energy,
                    us.cooldown_seconds,
                    us.effect_value AS utility_effect_value
                FROM vessel_equipments ve
                INNER JOIN items i ON i.item_code = ve.item_code
                LEFT JOIN weapon_specs ws ON ws.item_code = ve.item_code
                LEFT JOIN device_specs ds ON ds.item_code = ve.item_code
                LEFT JOIN vessel_modules vm ON vm.module_uid = ds.target_module_uid
                LEFT JOIN utility_specs us ON us.item_code = ve.item_code
                WHERE ve.vessel_uid IN (?)
                ORDER BY ve.vessel_uid ASC, ve.slot ASC`,
                [vesselUids]
            );
        }
        const equipByVessel = new Map();
        for (const eq of equipRows) {
            const vId = Number(eq.vessel_uid);
            if (!equipByVessel.has(vId)) equipByVessel.set(vId, []);
            equipByVessel.get(vId).push(eq);
        }

        // 5. Estoque do piloto no depósito da estação atual
        const playerStockMap = {};
        if (pilotStation) {
            const contRows = await conn.query(
                "SELECT container_uid FROM containers WHERE owner = ? AND storage = ? AND type = 'hangar' LIMIT 1",
                [pilotUid, pilotStation]
            );
            if (contRows.length > 0) {
                const hContUid = Number(contRows[0].container_uid);
                const slotRows = await conn.query(
                    "SELECT item_code, SUM(amount) AS total_amount FROM container_slots WHERE container_uid = ? GROUP BY item_code",
                    [hContUid]
                );
                for (const sr of slotRows) {
                    playerStockMap[Number(sr.item_code)] = Number(sr.total_amount);
                }
            }
        }

        // 6. Catálogo de itens disponíveis para equipamentos (Armas, Mísseis, Dispositivos, Utilitários)
        const marketStationId = pilotStation || 1;
        const catalogItems = await conn.query(
            `SELECT 
                i.item_code,
                i.item_type,
                i.group_code,
                i.name,
                i.price AS catalog_price,
                i.volume,
                i.image AS image_url,
                it.type AS type_name,
                ig.name AS group_name,
                ws.damage_per_second,
                ws.energy_consumption AS weapon_energy,
                ws.fire_range,
                ws.fire_rate,
                ws.auto_fire,
                ds.target_module_uid,
                vm.name AS target_module_name,
                ds.energy_consumption AS device_energy,
                ds.effect_value AS device_effect_value,
                ds.effect_type AS device_effect_type,
                us.usage_type,
                us.energy_consumption AS utility_energy,
                us.cooldown_seconds,
                us.effect_value AS utility_effect_value,
                us.effect_range AS utility_effect_range,
                COALESCE(sw.stock_balance, mi.stock, 10) AS market_stock,
                COALESCE(mi.selling_price, i.price, 10000) AS buy_price
            FROM items i
            LEFT JOIN item_types it ON it.type_code = i.item_type
            LEFT JOIN item_groups ig ON ig.group_code = i.group_code
            LEFT JOIN weapon_specs ws ON ws.item_code = i.item_code
            LEFT JOIN device_specs ds ON ds.item_code = i.item_code
            LEFT JOIN vessel_modules vm ON vm.module_uid = ds.target_module_uid
            LEFT JOIN utility_specs us ON us.item_code = i.item_code
            LEFT JOIN market_items mi ON mi.market_uid = ? AND mi.item_code = i.item_code AND mi.owner_pilot_uid = 0
            LEFT JOIN station_warehouse sw ON sw.station_id = ? AND sw.item_code = i.item_code AND sw.pilot_uid = 0 AND sw.status = 'ativo'
            WHERE i.item_type IN (2, 3, 4, 5) AND (i.active = 'SIM' OR i.active IS NULL)
            ORDER BY i.item_type ASC, i.name ASC`,
            [marketStationId, marketStationId]
        );

        const catalog = {
            'CANHÕES': [],
            'MÍSSEIS': [],
            'DISPOSITIVOS': [],
            'UTILITÁRIOS': []
        };

        for (const row of catalogItems) {
            const itCode = Number(row.item_code);
            const pStock = playerStockMap[itCode] || 0;
            const mStock = Number(row.market_stock || 10);
            const bPrice = Number(row.buy_price || row.catalog_price || 10000);
            const imgUrl = row.image_url || null;
            const iType = Number(row.item_type);

            if (row.item_type === 2) {
                catalog['CANHÕES'].push({
                    item_code: itCode,
                    item_type: iType,
                    name: row.name,
                    image_url: imgUrl,
                    dps: Math.round(Number(row.damage_per_second || 0)),
                    energy: Math.round(Number(row.weapon_energy || 0)),
                    range: Math.round(Number(row.fire_range || 0)),
                    stock: pStock,
                    inStock: pStock > 0,
                    market_stock: mStock,
                    buy_price: bPrice
                });
            } else if (row.item_type === 3) {
                catalog['MÍSSEIS'].push({
                    item_code: itCode,
                    item_type: iType,
                    name: row.name,
                    image_url: imgUrl,
                    dps: Math.round(Number(row.damage_per_second || 0)),
                    energy: Math.round(Number(row.weapon_energy || 0)),
                    range: Math.round(Number(row.fire_range || 0)),
                    stock: pStock,
                    inStock: pStock > 0,
                    market_stock: mStock,
                    buy_price: bPrice
                });
            } else if (row.item_type === 4) {
                const effStr = row.device_effect_type === 'percent'
                    ? `+${row.device_effect_value}%`
                    : `+${row.device_effect_value} MW`;
                catalog['DISPOSITIVOS'].push({
                    item_code: itCode,
                    item_type: iType,
                    name: row.name,
                    image_url: imgUrl,
                    energy: Math.round(Number(row.device_energy || 0)),
                    target_module: row.target_module_name || 'Sistema',
                    effect_value: effStr,
                    stock: pStock,
                    inStock: pStock > 0,
                    market_stock: mStock,
                    buy_price: bPrice
                });
            } else if (row.item_type === 5) {
                const uType = row.usage_type === 'rechargeable' ? 'Recarregável' : 'Consumível';
                catalog['UTILITÁRIOS'].push({
                    item_code: itCode,
                    item_type: iType,
                    name: row.name,
                    image_url: imgUrl,
                    energy: Math.round(Number(row.utility_energy || 0)),
                    usage_type: uType,
                    cooldown: `${row.cooldown_seconds || 0}s`,
                    effect_value: `+${row.utility_effect_value || 0}`,
                    stock: pStock,
                    inStock: pStock > 0,
                    market_stock: mStock,
                    buy_price: bPrice
                });
            }
        }

        const vessels = vesselRows.map(row => {
            const vOrbit = Number(row.orbit);
            const vStation = Number(row.station);
            const isAtCurrentStation =
                pilotOrbit !== null &&
                pilotStation !== null &&
                vOrbit === pilotOrbit &&
                vStation === pilotStation;

            const isSelected = String(row.selected || 'n').toLowerCase() === 'y' && isAtCurrentStation;

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
            if (row.image && String(row.image).trim() !== '') {
                const rawPath = String(row.image).trim();
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
                if (val < 80) return 'ATENÇÃO';
                return 'NOMINAL';
            };

            const calcSubRepairCost = (val) => {
                const subDmg = Math.max(0, 100.0 - Number(val || 100));
                return Math.round(basePrice * (subDmg / 500.0));
            };

            const sectorLabel = row.orbit_name ? String(row.orbit_name).toUpperCase() : `ÓRBITA ${vOrbit}`;
            const stationLabel = row.station_name ? String(row.station_name).toUpperCase() : `ESTAÇÃO ${vStation}`;

            const vUid = Number(row.vessel_uid);
            const vItemCode = Number(row.item_code);
            const vsp = specsMap.get(vItemCode) || null;
            const vesselEquips = equipByVessel.get(vUid) || [];
            const { hardpoints, stats } = buildVesselHardpointsAndStats(
                vUid,
                vItemCode,
                Number(row.cargo_capacity),
                vsp,
                vesselEquips
            );

            return {
                vessel_uid: vUid,
                pilot_uid: Number(row.pilot_uid),
                item_code: vItemCode,
                item_code_formatted: formatItemCode(row.item_code),
                name: String(row.vessel_name).toUpperCase(),
                registry: `Registro #${row.vessel_uid} · item ${formatItemCode(row.item_code)}`,
                selected: isSelected,
                status: isSelected ? 'ATIVA' : (isAtCurrentStation ? 'ATRACADA' : 'EM OUTRA ESTAÇÃO'),
                is_at_current_station: isAtCurrentStation,
                orbit: vOrbit,
                station: vStation,
                location_label: `${sectorLabel} – ${stationLabel}`,
                cargo_capacity: Number(row.cargo_capacity),
                base_price: basePrice,
                damage_percent: damagePercent,
                repair_cost: repairCost,
                integrity: avgIntegrity,
                hull_integrity: integrity,
                hologram_url: hologramUrl,
                image_3d_url: null,
                hardpoints,
                stats,
                subsystems: [
                    { key: 'integrity', name: 'Integridade do Casco', val: integrity, status: getSubStatus(integrity), repair_cost: calcSubRepairCost(integrity) },
                    { key: 'engine', name: 'Motores de Empuxo', val: engine, status: getSubStatus(engine), repair_cost: calcSubRepairCost(engine) },
                    { key: 'sensors', name: 'Sensores Orbitais', val: sensors, status: getSubStatus(sensors), repair_cost: calcSubRepairCost(sensors) },
                    { key: 'life_support', name: 'Suporte de Vida', val: lifeSupport, status: getSubStatus(lifeSupport), repair_cost: calcSubRepairCost(lifeSupport) },
                    { key: 'inertial_damper', name: 'Amortecedores Inerciais', val: inertialDamper, status: getSubStatus(inertialDamper), repair_cost: calcSubRepairCost(inertialDamper) }
                ]
            };
        });

        return res.json({
            status: "sucesso",
            data: {
                pilot: pilot ? {
                    pilot_uid: Number(pilot.pilot_uid),
                    name: pilot.pilot_name,
                    credits: pilotCredits,
                    orbit: pilotOrbit,
                    station: pilotStation,
                    docked: String(pilot.docked || 'y').toLowerCase() === 'y',
                    location_label: `${(pilot.orbit_name || `ÓRBITA ${pilotOrbit}`).toUpperCase()} – ${(pilot.station_name || `ESTAÇÃO ${pilotStation}`).toUpperCase()}`
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
            mensagem: "pilot_uid e vessel_uid são obrigatórios."
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
            return res.status(404).json({ status: "erro", mensagem: "Piloto não encontrado." });
        }

        const vesselRows = await conn.query(
            "SELECT vessel_uid, orbit, station FROM vessels WHERE vessel_uid = ? AND pilot_uid = ? LIMIT 1",
            [vessel_uid, pilot_uid]
        );
        if (vesselRows.length === 0) {
            return res.status(404).json({ status: "erro", mensagem: "Nave não encontrada para este piloto." });
        }

        const pilot = pilotRows[0];
        const vessel = vesselRows[0];

        if (Number(pilot.orbit) !== Number(vessel.orbit) || Number(pilot.station) !== Number(vessel.station)) {
            return res.status(400).json({
                status: "erro",
                mensagem: "Você precisa estar na mesma estação onde esta nave está atracada para ativá-la."
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
            mensagem: "pilot_uid e vessel_uid são obrigatórios."
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
            return res.status(404).json({ status: "erro", mensagem: "Piloto não encontrado." });
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
            return res.status(404).json({ status: "erro", mensagem: "Nave não encontrada para este piloto." });
        }

        const pilot = pilotRows[0];
        const vessel = vesselRows[0];

        if (Number(pilot.orbit) !== Number(vessel.orbit) || Number(pilot.station) !== Number(vessel.station)) {
            await conn.rollback();
            return res.status(400).json({
                status: "erro",
                mensagem: "A nave precisa estar na mesma estação em que você se encontra para realizar reparos."
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
                return res.status(400).json({ status: "erro", mensagem: "Este subsistema já está em 100%." });
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
                return res.status(400).json({ status: "erro", mensagem: "Todos os subsistemas desta nave já estão em 100%!" });
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
                mensagem: `Créditos insuficientes para o reparo! Custo: ${repairCost} CR | Saldo: ${currentCredits} CR.`
            });
        }

        const stationId = Number(vessel.station || pilot.station || 1);
        await conn.query("INSERT IGNORE INTO wallets (wallet_uid, cash, credits) VALUES (?, 0, 1000000000)", [stationId]);
        const stationW = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? FOR UPDATE", [stationId]);
        const stationBefore = stationW.length > 0 ? Number(stationW[0].credits) : 1000000000;
        const stationAfter = stationBefore + repairCost;
        await conn.query("UPDATE wallets SET credits = ? WHERE wallet_uid = ?", [stationAfter, stationId]);

        const newCredits = currentCredits - repairCost;
        await conn.query("UPDATE wallets SET credits = ? WHERE wallet_uid = ?", [newCredits, pilot_uid]);
        await conn.query(
            `INSERT INTO wallet_transactions (wallet_from, wallet_to, amount, balance_from_before, balance_from_after, balance_to_before, balance_to_after, operation_type, reference_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'vessel_repair', ?)`,
            [pilot_uid, stationId, repairCost, currentCredits, newCredits, stationBefore, stationAfter, vessel_uid]
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

const getHangarInventory = async (req, res) => {
    const pilotUid = req.params.pilotUid || req.query.pilot_uid;
    if (!pilotUid) {
        return res.status(400).json({ status: "erro", mensagem: "pilotUid é obrigatório." });
    }

    let conn;
    try {
        conn = await db.getConnection();

        // 1. Localização atual do piloto
        const pilotRows = await conn.query(
            `SELECT p.pilot_uid, p.pilot AS pilot_name, p.orbit, p.station, p.docked,
                    s.name AS orbit_name,
                    st.name AS station_name
             FROM pilots p
             LEFT JOIN orbits s ON s.id = p.orbit
             LEFT JOIN orbit_stations st ON st.id = p.station
             WHERE p.pilot_uid = ?
             LIMIT 1`,
            [pilotUid]
        );

        if (pilotRows.length === 0) {
            return res.status(404).json({ status: "erro", mensagem: "Piloto não encontrado." });
        }

        const pilot = pilotRows[0];
        const isAllStations = req.query.station_id === 'all' || req.query.station === 'all' || req.query.all === 'true' || req.query.all_stations === 'true';

        let targetStationId = Number(pilot.station) || 1;
        let targetOrbitId = Number(pilot.orbit) || 2;
        let targetStationName = pilot.station_name || `ESTAÇÃO ${targetStationId}`;

        if (!isAllStations && (req.query.station_id || req.query.station)) {
            const rawStationParam = req.query.station_id || req.query.station;
            const parsedStId = parseInt(rawStationParam, 10);
            if (!isNaN(parsedStId) && parsedStId > 0) {
                targetStationId = parsedStId;
                const stRows = await conn.query(
                    `SELECT s.id AS station_id, s.name AS station_name, s.orbit_id, o.name AS orbit_name
                     FROM orbit_stations s
                     LEFT JOIN orbits o ON o.id = s.orbit_id
                     WHERE s.id = ?
                     LIMIT 1`,
                    [targetStationId]
                );
                if (stRows.length > 0) {
                    targetStationName = stRows[0].station_name || `ESTAÇÃO ${targetStationId}`;
                    targetOrbitId = Number(stRows[0].orbit_id) || targetOrbitId;
                }
            }
        }

        // 2. Container do depósito da estação (hangar)
        let stationContainerUid = null;
        let stationMaxVol = 50000;
        let stationSlotRows = [];

        if (isAllStations) {
            stationSlotRows = await conn.query(
                `SELECT cs.item_code, SUM(cs.amount) AS amount,
                        i.name, i.item_type, COALESCE(i.volume, 1) AS volume, i.image
                 FROM containers c
                 INNER JOIN container_slots cs ON cs.container_uid = c.container_uid
                 INNER JOIN items i ON i.item_code = cs.item_code
                 WHERE c.owner = ? AND c.type = 'hangar' AND cs.amount > 0
                 GROUP BY cs.item_code, i.name, i.item_type, i.volume, i.image
                 ORDER BY i.item_type ASC, i.name ASC`,
                [pilotUid]
            );
        } else {
            let contRows = await conn.query(
                "SELECT container_uid, max_volume, current_volume FROM containers WHERE owner = ? AND storage = ? AND type = 'hangar' LIMIT 1",
                [pilotUid, targetStationId]
            );
            let stationContainer;
            if (contRows.length === 0) {
                const resInsert = await conn.query(
                    "INSERT INTO containers (owner, storage, type, max_volume, current_volume, protected) VALUES (?, ?, 'hangar', 50000, 0, 'y')",
                    [pilotUid, targetStationId]
                );
                stationContainer = { container_uid: Number(resInsert.insertId), max_volume: 50000, current_volume: 0 };
            } else {
                stationContainer = contRows[0];
            }
            stationContainerUid = Number(stationContainer.container_uid);
            stationMaxVol = Number(stationContainer.max_volume) || 50000;

            stationSlotRows = await conn.query(
                `SELECT cs.slot, cs.item_code, cs.amount,
                        i.name, i.item_type, COALESCE(i.volume, 1) AS volume, i.image
                 FROM container_slots cs
                 INNER JOIN items i ON i.item_code = cs.item_code
                 WHERE cs.container_uid = ? AND cs.amount > 0
                 ORDER BY i.item_type ASC, i.name ASC`,
                [stationContainerUid]
            );
        }

        let stationUsedVol = 0;
        const stationItems = stationSlotRows.map(r => {
            const amount = Number(r.amount);
            const unitVol = Number(r.volume || 1);
            const totalVol = amount * unitVol;
            stationUsedVol += totalVol;

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

        if (!isAllStations && stationContainerUid) {
            await conn.query("UPDATE containers SET current_volume = ? WHERE container_uid = ?", [stationUsedVol, stationContainerUid]);
        }

        // 4. Naves do piloto atracadas na estação alvo (ou todas caso query all=true)
        let vesselQuery = `
            SELECT v.vessel_uid, v.pilot_uid, v.item_code, v.selected,
                   v.orbit, v.station,
                   st.name AS station_name,
                   COALESCE(i.name, CONCAT('Nave #', v.vessel_uid)) AS vessel_name,
                   COALESCE(i.volume, 1000) AS ship_volume,
                   i.image
            FROM vessels v
            LEFT JOIN items i ON i.item_code = v.item_code
            LEFT JOIN orbit_stations st ON st.id = v.station
            WHERE v.pilot_uid = ?
        `;
        const vesselParams = [pilotUid];
        if (!isAllStations) {
            vesselQuery += ` AND v.station = ?`;
            vesselParams.push(targetStationId);
        }
        vesselQuery += ` ORDER BY (v.selected = 'y' AND v.station = ?) DESC, v.vessel_uid ASC`;
        vesselParams.push(Number(pilot.station) || 1);

        const vesselRows = await conn.query(vesselQuery, vesselParams);

        const vessels = [];
        for (const v of vesselRows) {
            const vUid = Number(v.vessel_uid);
            const defaultShipMaxCargo = Math.round(Number(v.ship_volume || 1000) * 0.3) || 300;

            let cargoContRows = await conn.query(
                "SELECT container_uid, max_volume, current_volume FROM containers WHERE owner = ? AND storage = ? AND type = 'vessel_cargo' LIMIT 1",
                [pilotUid, vUid]
            );
            let cargoContainer;
            if (cargoContRows.length === 0) {
                const insCargo = await conn.query(
                    "INSERT INTO containers (owner, storage, type, max_volume, current_volume, protected) VALUES (?, ?, 'vessel_cargo', ?, 0, 'n')",
                    [pilotUid, vUid, defaultShipMaxCargo]
                );
                cargoContainer = { container_uid: Number(insCargo.insertId), max_volume: defaultShipMaxCargo, current_volume: 0 };
            } else {
                cargoContainer = cargoContRows[0];
            }
            const cargoContUid = Number(cargoContainer.container_uid);
            const cargoMaxVol = Number(cargoContainer.max_volume) || defaultShipMaxCargo;

            const cargoSlotRows = await conn.query(
                `SELECT cs.slot, cs.item_code, cs.amount,
                        i.name, i.item_type, COALESCE(i.volume, 1) AS volume, i.image
                 FROM container_slots cs
                 INNER JOIN items i ON i.item_code = cs.item_code
                 WHERE cs.container_uid = ? AND cs.amount > 0
                 ORDER BY i.item_type ASC, i.name ASC`,
                [cargoContUid]
            );

            let cargoUsedVol = 0;
            const cargoItems = cargoSlotRows.map(cr => {
                const amount = Number(cr.amount);
                const uVol = Number(cr.volume || 1);
                const tVol = amount * uVol;
                cargoUsedVol += tVol;

                let cImg = cr.image || null;
                if (cImg && typeof cImg === 'string') {
                    if (cImg.toLowerCase().endsWith('.svg')) {
                        cImg = cImg.replace(/\.svg$/i, '.png');
                    }
                    if (!cImg.startsWith('http') && !cImg.startsWith('/')) {
                        cImg = `/items/${cImg}`;
                    }
                }

                return {
                    item_code: Number(cr.item_code),
                    name: String(cr.name || '').toUpperCase(),
                    item_type: Number(cr.item_type),
                    amount,
                    unit_volume: uVol,
                    volume: uVol,
                    total_volume: tVol,
                    image_url: cImg
                };
            });

            if (Number(cargoContainer.current_volume) !== cargoUsedVol) {
                await conn.query("UPDATE containers SET current_volume = ? WHERE container_uid = ?", [cargoUsedVol, cargoContUid]);
            }

            let holoUrl = null;
            if (v.image && String(v.image).trim() !== '') {
                const rawPath = String(v.image).trim();
                if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
                    holoUrl = rawPath;
                } else {
                    let fileName = rawPath.split(/[\\/]/).pop();
                    if (fileName) {
                        fileName = fileName.replace(/\.svg$/i, '.png');
                        holoUrl = `/hologramas/${encodeURIComponent(fileName)}`;
                    }
                }
            }

            vessels.push({
                vessel_uid: vUid,
                name: String(v.vessel_name).toUpperCase(),
                selected: String(v.selected || 'n').toLowerCase() === 'y' && Number(v.station) === Number(pilot.station),
                station_id: Number(v.station),
                station_name: v.station_name || `ESTAÇÃO ${v.station}`,
                orbit_id: Number(v.orbit),
                is_at_current_station: Number(v.station) === Number(pilot.station),
                hologram_url: holoUrl,
                max_cargo_volume: cargoMaxVol,
                used_cargo_volume: cargoUsedVol,
                available_cargo_volume: Math.max(0, cargoMaxVol - cargoUsedVol),
                cargo_items: cargoItems
            });
        }

        return res.json({
            status: "sucesso",
            data: {
                station: {
                    station_id: isAllStations ? null : targetStationId,
                    station_name: isAllStations ? "TODAS AS ESTAÇÕES" : targetStationName.toUpperCase(),
                    max_volume: stationMaxVol,
                    used_volume: stationUsedVol,
                    available_volume: Math.max(0, stationMaxVol - stationUsedVol),
                    items: stationItems
                },
                vessels
            }
        });

    } catch (err) {
        console.error("[Hangar getHangarInventory Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

const transferCargo = async (req, res) => {
    const { pilot_uid, vessel_uid, item_code, quantity, direction } = req.body;
    const qty = parseInt(quantity, 10);

    if (!pilot_uid || !vessel_uid || !item_code || !qty || qty <= 0 || !direction) {
        return res.status(400).json({
            status: "erro",
            mensagem: "Parâmetros inválidos para transferência de carga."
        });
    }

    if (direction !== 'TO_VESSEL' && direction !== 'TO_STATION' && direction !== 'TO_SHIP') {
        return res.status(400).json({
            status: "erro",
            mensagem: "Direção inválida. Use 'TO_VESSEL' ou 'TO_STATION'."
        });
    }

    const normDirection = (direction === 'TO_SHIP') ? 'TO_VESSEL' : direction;

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        // 1. Verifica localização do piloto
        const pilotRows = await conn.query(
            "SELECT orbit, station FROM pilots WHERE pilot_uid = ? LIMIT 1",
            [pilot_uid]
        );
        if (pilotRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Piloto não encontrado." });
        }
        const stationId = Number(pilotRows[0].station) || 1;

        // 2. Verifica a nave e se está na mesma estação
        const vesselRows = await conn.query(
            "SELECT vessel_uid, orbit, station FROM vessels WHERE vessel_uid = ? AND pilot_uid = ? LIMIT 1",
            [vessel_uid, pilot_uid]
        );
        if (vesselRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Nave não encontrada." });
        }
        if (Number(vesselRows[0].station) !== stationId) {
            await conn.rollback();
            return res.status(400).json({
                status: "erro",
                mensagem: "A nave não está atracada na mesma estação que você."
            });
        }

        // 3. Obtém dados do item (volume)
        const itemRows = await conn.query(
            "SELECT item_code, COALESCE(volume, 1) AS volume FROM items WHERE item_code = ? LIMIT 1",
            [item_code]
        );
        if (itemRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Item não encontrado." });
        }
        const itemVolume = Number(itemRows[0].volume || 1);
        const totalVolumeToMove = qty * itemVolume;

        // 4. Obtém os containers de hangar e nave
        const hangarContRows = await conn.query(
            "SELECT container_uid, max_volume, current_volume FROM containers WHERE owner = ? AND storage = ? AND type = 'hangar' LIMIT 1 FOR UPDATE",
            [pilot_uid, stationId]
        );
        if (hangarContRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Depósito da estação não encontrado." });
        }
        const hangarContainer = hangarContRows[0];
        const hangarUid = Number(hangarContainer.container_uid);

        const shipContRows = await conn.query(
            "SELECT container_uid, max_volume, current_volume FROM containers WHERE owner = ? AND storage = ? AND type = 'vessel_cargo' LIMIT 1 FOR UPDATE",
            [pilot_uid, vessel_uid]
        );
        if (shipContRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Compartimento de carga da nave não encontrado." });
        }
        const shipContainer = shipContRows[0];
        const shipUid = Number(shipContainer.container_uid);

        // Dedução
        const deductItems = async (cUid, itCode, amountToDeduct) => {
            const slots = await conn.query(
                "SELECT slot, amount FROM container_slots WHERE container_uid = ? AND item_code = ? ORDER BY slot ASC FOR UPDATE",
                [cUid, itCode]
            );
            const totalAvail = slots.reduce((acc, s) => acc + Number(s.amount), 0);
            if (totalAvail < amountToDeduct) {
                return false;
            }
            let rem = amountToDeduct;
            for (const s of slots) {
                if (rem <= 0) break;
                const slotAmt = Number(s.amount);
                if (slotAmt <= rem) {
                    await conn.query("DELETE FROM container_slots WHERE container_uid = ? AND slot = ?", [cUid, s.slot]);
                    rem -= slotAmt;
                } else {
                    await conn.query("UPDATE container_slots SET amount = amount - ? WHERE container_uid = ? AND slot = ?", [rem, cUid, s.slot]);
                    rem = 0;
                }
            }
            return true;
        };

        // Adição
        const addItems = async (cUid, itCode, amountToAdd) => {
            const existing = await conn.query(
                "SELECT slot FROM container_slots WHERE container_uid = ? AND item_code = ? LIMIT 1 FOR UPDATE",
                [cUid, itCode]
            );
            if (existing.length > 0) {
                await conn.query(
                    "UPDATE container_slots SET amount = amount + ? WHERE container_uid = ? AND slot = ?",
                    [amountToAdd, cUid, existing[0].slot]
                );
            } else {
                const maxSlotRow = await conn.query(
                    "SELECT COALESCE(MAX(slot), 0) AS max_slot FROM container_slots WHERE container_uid = ?",
                    [cUid]
                );
                const nextSlot = Number(maxSlotRow[0].max_slot || 0) + 1;
                await conn.query(
                    "INSERT INTO container_slots (container_uid, slot, item_code, amount) VALUES (?, ?, ?, ?)",
                    [cUid, nextSlot, itCode, amountToAdd]
                );
            }
        };

        // Recalcular volume
        const refreshContainerVolume = async (cUid) => {
            const volRow = await conn.query(
                `SELECT COALESCE(SUM(cs.amount * COALESCE(i.volume, 1)), 0) AS total_vol
                 FROM container_slots cs
                 INNER JOIN items i ON i.item_code = cs.item_code
                 WHERE cs.container_uid = ?`,
                [cUid]
            );
            const vol = Number(volRow[0].total_vol || 0);
            await conn.query("UPDATE containers SET current_volume = ? WHERE container_uid = ?", [vol, cUid]);
            return vol;
        };

        if (normDirection === 'TO_VESSEL') {
            const shipAvailVol = Number(shipContainer.max_volume) - Number(shipContainer.current_volume);
            if (totalVolumeToMove > shipAvailVol) {
                await conn.rollback();
                return res.status(400).json({
                    status: "erro",
                    mensagem: `Espaço insuficiente na nave. Necessário: ${totalVolumeToMove}m³, Disponível: ${shipAvailVol}m³.`
                });
            }
            const deducted = await deductItems(hangarUid, item_code, qty);
            if (!deducted) {
                await conn.rollback();
                return res.status(400).json({
                    status: "erro",
                    mensagem: "Quantidade insuficiente no depósito da estação."
                });
            }
            await addItems(shipUid, item_code, qty);

        } else if (normDirection === 'TO_STATION') {
            const hangarAvailVol = Number(hangarContainer.max_volume) - Number(hangarContainer.current_volume);
            if (totalVolumeToMove > hangarAvailVol) {
                await conn.rollback();
                return res.status(400).json({
                    status: "erro",
                    mensagem: `Espaço insuficiente no depósito da estação. Necessário: ${totalVolumeToMove}m³, Disponível: ${hangarAvailVol}m³.`
                });
            }
            const deducted = await deductItems(shipUid, item_code, qty);
            if (!deducted) {
                await conn.rollback();
                return res.status(400).json({
                    status: "erro",
                    mensagem: "Quantidade insuficiente na nave."
                });
            }
            await addItems(hangarUid, item_code, qty);
        }

        const newStationVol = await refreshContainerVolume(hangarUid);
        const newShipVol = await refreshContainerVolume(shipUid);

        await conn.commit();

        return res.json({
            status: "sucesso",
            mensagem: "Carga transferida com sucesso!",
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

const equipSlot = async (req, res) => {
    const { pilot_uid, vessel_uid, db_slot, item_code, buy_if_missing } = req.body;
    if (!pilot_uid || !vessel_uid || !item_code || db_slot === undefined || db_slot === null) {
        return res.status(400).json({
            status: "erro",
            mensagem: "pilot_uid, vessel_uid, db_slot e item_code são obrigatórios."
        });
    }

    const slotNum = parseInt(db_slot, 10);
    const itemCodeNum = parseInt(item_code, 10);
    const vesselUidNum = parseInt(vessel_uid, 10);
    const pilotUidNum = parseInt(pilot_uid, 10);

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        // 1. Piloto e Estação
        const pilotRows = await conn.query(
            "SELECT orbit, station FROM pilots WHERE pilot_uid = ? LIMIT 1",
            [pilotUidNum]
        );
        if (pilotRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Piloto não encontrado." });
        }
        const stationId = Number(pilotRows[0].station) || 1;

        // 2. Nave pertence ao piloto e está na mesma estação
        const vesselRows = await conn.query(
            "SELECT vessel_uid, orbit, station, item_code FROM vessels WHERE vessel_uid = ? AND pilot_uid = ? LIMIT 1",
            [vesselUidNum, pilotUidNum]
        );
        if (vesselRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Nave não encontrada para este piloto." });
        }
        if (Number(vesselRows[0].station) !== stationId) {
            await conn.rollback();
            return res.status(400).json({
                status: "erro",
                mensagem: "Apenas naves atracadas na mesma estação que você podem ser modificadas."
            });
        }

        // 3. Dados do item a equipar
        const itemRows = await conn.query(
            "SELECT item_code, item_type, name, price, volume FROM items WHERE item_code = ? LIMIT 1",
            [itemCodeNum]
        );
        if (itemRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Item não encontrado no catálogo." });
        }
        const item = itemRows[0];
        const itemType = Number(item.item_type);

        let equipType = 'weapon';
        if (itemType === 2) equipType = 'weapon';
        else if (itemType === 3) equipType = 'missile';
        else if (itemType === 4) equipType = 'device';
        else if (itemType === 5) equipType = 'utility';
        else {
            await conn.rollback();
            return res.status(400).json({
                status: "erro",
                mensagem: "Este item não é um equipamento instalável em hardpoints."
            });
        }

        // 4. Container do depósito da estação
        let contRows = await conn.query(
            "SELECT container_uid FROM containers WHERE owner = ? AND storage = ? AND type = 'hangar' LIMIT 1 FOR UPDATE",
            [pilotUidNum, stationId]
        );
        let hangarUid;
        if (contRows.length === 0) {
            const insHangar = await conn.query(
                "INSERT INTO containers (owner, storage, type, max_volume, current_volume, protected) VALUES (?, ?, 'hangar', 50000, 0, 'y')",
                [pilotUidNum, stationId]
            );
            hangarUid = Number(insHangar.insertId);
        } else {
            hangarUid = Number(contRows[0].container_uid);
        }

        // 5. Verifica se o piloto possui o item no depósito
        const stockRows = await conn.query(
            "SELECT slot, amount FROM container_slots WHERE container_uid = ? AND item_code = ? AND amount > 0 ORDER BY slot ASC LIMIT 1 FOR UPDATE",
            [hangarUid, itemCodeNum]
        );

        const hasInStock = stockRows.length > 0;

        if (hasInStock) {
            // Deduz do depósito do piloto
            const currAmt = Number(stockRows[0].amount);
            if (currAmt > 1) {
                await conn.query(
                    "UPDATE container_slots SET amount = amount - 1 WHERE container_uid = ? AND slot = ?",
                    [hangarUid, stockRows[0].slot]
                );
            } else {
                await conn.query(
                    "DELETE FROM container_slots WHERE container_uid = ? AND slot = ?",
                    [hangarUid, stockRows[0].slot]
                );
            }
        } else if (buy_if_missing) {
            // Compra do mercado da estação
            const mktRows = await conn.query(
                "SELECT selling_price FROM market_items WHERE market_uid = ? AND item_code = ? AND owner_pilot_uid = 0 LIMIT 1",
                [stationId, itemCodeNum]
            );
            const unitPrice = mktRows.length > 0 ? Number(mktRows[0].selling_price) : Number(item.price || 10000);

            const walletRows = await conn.query(
                "SELECT credits FROM wallets WHERE wallet_uid = ? LIMIT 1 FOR UPDATE",
                [pilotUidNum]
            );
            const currentCredits = walletRows.length > 0 ? Number(walletRows[0].credits) : 0;
            if (currentCredits < unitPrice) {
                await conn.rollback();
                return res.status(400).json({
                    status: "erro",
                    mensagem: `Créditos insuficientes para comprar ${item.name} (${unitPrice.toLocaleString('pt-BR')} CR necessários).`
                });
            }

            // Deduz créditos do piloto e credita a estação
            const buyerBefore = currentCredits;
            const buyerAfter = buyerBefore - unitPrice;
            await conn.query(
                "UPDATE wallets SET credits = ? WHERE wallet_uid = ?",
                [buyerAfter, pilotUidNum]
            );

            await conn.query("INSERT IGNORE INTO wallets (wallet_uid, cash, credits) VALUES (?, 0, 1000000000)", [stationId]);
            const stationW = await conn.query("SELECT credits FROM wallets WHERE wallet_uid = ? FOR UPDATE", [stationId]);
            const stationBefore = stationW.length > 0 ? Number(stationW[0].credits) : 1000000000;
            const stationAfter = stationBefore + unitPrice;
            await conn.query("UPDATE wallets SET credits = ? WHERE wallet_uid = ?", [stationAfter, stationId]);

            await conn.query(
                `INSERT INTO wallet_transactions (wallet_from, wallet_to, amount, balance_from_before, balance_from_after, balance_to_before, balance_to_after, operation_type, reference_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'market_station_buy', ?)`,
                [pilotUidNum, stationId, unitPrice, buyerBefore, buyerAfter, stationBefore, stationAfter, itemCodeNum]
            );

            // Se houver registro no station_warehouse, deduz saldo
            await conn.query(
                "UPDATE station_warehouse SET stock_balance = GREATEST(0, stock_balance - 1) WHERE station_id = ? AND item_code = ? AND pilot_uid = 0 AND status = 'ativo'",
                [stationId, itemCodeNum]
            );
        } else {
            await conn.rollback();
            return res.status(400).json({
                status: "erro",
                mensagem: `Você não possui ${item.name} em seu depósito da estação.`
            });
        }

        // 6. Verifica se o slot já tinha um item equipado
        const existingEq = await conn.query(
            "SELECT item_code, amount, type FROM vessel_equipments WHERE vessel_uid = ? AND slot = ? LIMIT 1 FOR UPDATE",
            [vesselUidNum, slotNum]
        );

        if (existingEq.length > 0) {
            // Devolve o item anterior ao depósito
            const oldCode = Number(existingEq[0].item_code);
            const oldAmt = Number(existingEq[0].amount || 1);

            const existingHangarSlot = await conn.query(
                "SELECT slot FROM container_slots WHERE container_uid = ? AND item_code = ? LIMIT 1 FOR UPDATE",
                [hangarUid, oldCode]
            );

            if (existingHangarSlot.length > 0) {
                await conn.query(
                    "UPDATE container_slots SET amount = amount + ? WHERE container_uid = ? AND slot = ?",
                    [oldAmt, hangarUid, existingHangarSlot[0].slot]
                );
            } else {
                const maxSlotRow = await conn.query(
                    "SELECT COALESCE(MAX(slot), -1) AS max_slot FROM container_slots WHERE container_uid = ?",
                    [hangarUid]
                );
                const nextSlot = Number(maxSlotRow[0].max_slot || -1) + 1;
                await conn.query(
                    "INSERT INTO container_slots (container_uid, slot, item_code, amount) VALUES (?, ?, ?, ?)",
                    [hangarUid, nextSlot, oldCode, oldAmt]
                );
            }
        }

        // 7. Equipa o novo item no slot
        await conn.query(
            `INSERT INTO vessel_equipments (vessel_uid, slot, item_code, type, amount)
             VALUES (?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE item_code = VALUES(item_code), type = VALUES(type), amount = VALUES(amount)`,
            [vesselUidNum, slotNum, itemCodeNum, equipType]
        );

        // 8. Atualiza volume do depósito
        const volRow = await conn.query(
            `SELECT COALESCE(SUM(cs.amount * COALESCE(i.volume, 1)), 0) AS total_vol
             FROM container_slots cs
             INNER JOIN items i ON i.item_code = cs.item_code
             WHERE cs.container_uid = ?`,
            [hangarUid]
        );
        await conn.query("UPDATE containers SET current_volume = ? WHERE container_uid = ?", [Number(volRow[0].total_vol || 0), hangarUid]);

        await conn.commit();

        return res.json({
            status: "sucesso",
            mensagem: `${item.name} equipado com sucesso!`
        });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error("[Hangar equipSlot Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

const unequipSlot = async (req, res) => {
    const { pilot_uid, vessel_uid, db_slot } = req.body;
    if (!pilot_uid || !vessel_uid || db_slot === undefined || db_slot === null) {
        return res.status(400).json({
            status: "erro",
            mensagem: "pilot_uid, vessel_uid e db_slot são obrigatórios."
        });
    }

    const slotNum = parseInt(db_slot, 10);
    const vesselUidNum = parseInt(vessel_uid, 10);
    const pilotUidNum = parseInt(pilot_uid, 10);

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        // 1. Piloto e Estação
        const pilotRows = await conn.query(
            "SELECT orbit, station FROM pilots WHERE pilot_uid = ? LIMIT 1",
            [pilotUidNum]
        );
        if (pilotRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Piloto não encontrado." });
        }
        const stationId = Number(pilotRows[0].station) || 1;

        // 2. Nave pertence ao piloto e está na mesma estação
        const vesselRows = await conn.query(
            "SELECT vessel_uid, orbit, station FROM vessels WHERE vessel_uid = ? AND pilot_uid = ? LIMIT 1",
            [vesselUidNum, pilotUidNum]
        );
        if (vesselRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ status: "erro", mensagem: "Nave não encontrada para este piloto." });
        }
        if (Number(vesselRows[0].station) !== stationId) {
            await conn.rollback();
            return res.status(400).json({
                status: "erro",
                mensagem: "Apenas naves atracadas na mesma estação que você podem ter o loadout modificado."
            });
        }

        // 3. Item atualmente no slot
        const eqRows = await conn.query(
            "SELECT item_code, amount, type FROM vessel_equipments WHERE vessel_uid = ? AND slot = ? LIMIT 1 FOR UPDATE",
            [vesselUidNum, slotNum]
        );
        if (eqRows.length === 0) {
            await conn.rollback();
            return res.json({
                status: "sucesso",
                mensagem: "O slot já se encontra vazio."
            });
        }

        const oldCode = Number(eqRows[0].item_code);
        const oldAmt = Number(eqRows[0].amount || 1);

        // 4. Container do depósito da estação
        let contRows = await conn.query(
            "SELECT container_uid FROM containers WHERE owner = ? AND storage = ? AND type = 'hangar' LIMIT 1 FOR UPDATE",
            [pilotUidNum, stationId]
        );
        let hangarUid;
        if (contRows.length === 0) {
            const insHangar = await conn.query(
                "INSERT INTO containers (owner, storage, type, max_volume, current_volume, protected) VALUES (?, ?, 'hangar', 50000, 0, 'y')",
                [pilotUidNum, stationId]
            );
            hangarUid = Number(insHangar.insertId);
        } else {
            hangarUid = Number(contRows[0].container_uid);
        }

        // 5. Devolve ao depósito da estação
        const existingSlot = await conn.query(
            "SELECT slot FROM container_slots WHERE container_uid = ? AND item_code = ? LIMIT 1 FOR UPDATE",
            [hangarUid, oldCode]
        );

        if (existingSlot.length > 0) {
            await conn.query(
                "UPDATE container_slots SET amount = amount + ? WHERE container_uid = ? AND slot = ?",
                [oldAmt, hangarUid, existingSlot[0].slot]
            );
        } else {
            const maxSlotRow = await conn.query(
                "SELECT COALESCE(MAX(slot), -1) AS max_slot FROM container_slots WHERE container_uid = ?",
                [hangarUid]
            );
            const nextSlot = Number(maxSlotRow[0].max_slot || -1) + 1;
            await conn.query(
                "INSERT INTO container_slots (container_uid, slot, item_code, amount) VALUES (?, ?, ?, ?)",
                [hangarUid, nextSlot, oldCode, oldAmt]
            );
        }

        // 6. Remove do vessel_equipments
        await conn.query(
            "DELETE FROM vessel_equipments WHERE vessel_uid = ? AND slot = ?",
            [vesselUidNum, slotNum]
        );

        // 7. Atualiza volume do depósito
        const volRow = await conn.query(
            `SELECT COALESCE(SUM(cs.amount * COALESCE(i.volume, 1)), 0) AS total_vol
             FROM container_slots cs
             INNER JOIN items i ON i.item_code = cs.item_code
             WHERE cs.container_uid = ?`,
            [hangarUid]
        );
        await conn.query("UPDATE containers SET current_volume = ? WHERE container_uid = ?", [Number(volRow[0].total_vol || 0), hangarUid]);

        await conn.commit();

        return res.json({
            status: "sucesso",
            mensagem: "Item removido para o depósito!"
        });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error("[Hangar unequipSlot Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

const getAssetStations = async (req, res) => {
    const pilotUid = req.params.pilotUid || req.query.pilot_uid;
    if (!pilotUid) {
        return res.status(400).json({ status: "erro", mensagem: "pilotUid é obrigatório." });
    }

    let conn;
    try {
        conn = await db.getConnection();
        const rows = await conn.query(
            `SELECT DISTINCT st.id, st.name
             FROM orbit_stations st
             WHERE st.id IN (
                 SELECT c.storage
                 FROM containers c
                 INNER JOIN container_slots cs ON cs.container_uid = c.container_uid
                 WHERE c.owner = ? AND c.type = 'hangar' AND cs.amount > 0
                 UNION
                 SELECT v.station
                 FROM vessels v
                 INNER JOIN containers c2 ON c2.owner = ? AND c2.storage = v.vessel_uid AND c2.type = 'vessel_cargo'
                 INNER JOIN container_slots cs2 ON cs2.container_uid = c2.container_uid
                 WHERE v.pilot_uid = ? AND cs2.amount > 0
             )
             ORDER BY st.name ASC`,
            [pilotUid, pilotUid, pilotUid]
        );

        return res.json({
            status: "sucesso",
            data: rows.map(r => ({
                id: Number(r.id),
                name: String(r.name).toUpperCase()
            }))
        });
    } catch (err) {
        console.error("[Hangar getAssetStations Error]:", err);
        return res.status(500).json({ status: "erro", mensagem: err.message });
    } finally {
        if (conn) conn.release();
    }
};

module.exports = {
    getPilotFleet,
    selectActiveVessel,
    repairVessel,
    getHangarInventory,
    getPilotInventory: getHangarInventory,
    transferCargo,
    equipSlot,
    equipVesselSlot: equipSlot,
    unequipSlot,
    unequipVesselSlot: unequipSlot,
    getAssetStations
};
