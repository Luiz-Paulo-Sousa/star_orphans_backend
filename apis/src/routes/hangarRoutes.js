const express = require('express');
const router = express.Router();
const hangarController = require('../controllers/hangarController');

router.get('/hangar/fleet/:pilotUid', hangarController.getPilotFleet);
router.put('/hangar/select-vessel', hangarController.selectActiveVessel);
router.post('/hangar/repair-vessel', hangarController.repairVessel);
router.post('/hangar/equip-slot', hangarController.equipVesselSlot);
router.post('/hangar/unequip-slot', hangarController.unequipVesselSlot);
router.get('/hangar/inventory/:pilotUid', hangarController.getPilotInventory);
router.post('/hangar/transfer-cargo', hangarController.transferCargo);

module.exports = router;