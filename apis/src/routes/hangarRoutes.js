const Express = require('express');
const router = Express.Router();
const hangarController = require('../controllers/hangarController');

router.get('/hangar/fleet/:pilotUid', hangarController.getPilotFleet);
router.get('/hangar/fleet', hangarController.getPilotFleet);
router.put('/hangar/select-vessel', hangarController.selectActiveVessel);
if (hangarController.repairVessel) {
    router.post('/hangar/repair-vessel', hangarController.repairVessel);
}

router.get('/hangar/inventory/:pilotUid', hangarController.getHangarInventory || hangarController.getPilotInventory);
router.get('/hangar/inventory', hangarController.getHangarInventory || hangarController.getPilotInventory);
router.get('/hangar/asset-stations/:pilotUid', hangarController.getAssetStations);
router.get('/hangar/asset-stations', hangarController.getAssetStations);
router.post('/hangar/transfer-cargo', hangarController.transferCargo);
router.post('/hangar/equip-slot', hangarController.equipSlot || hangarController.equipVesselSlot);
router.post('/hangar/unequip-slot', hangarController.unequipSlot || hangarController.unequipVesselSlot);

module.exports = router;
