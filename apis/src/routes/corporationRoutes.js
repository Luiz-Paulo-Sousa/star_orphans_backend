const express = require('express');
const router = express.Router();
const corporationController = require('../controllers/corporationController');

router.get('/corporation/status/:pilotUid', corporationController.getCorporationStatus);
router.get('/corporation/list', corporationController.getActiveCorporations);
router.get('/corporation/stations', corporationController.getAvailableStations);
router.post('/corporation/apply', corporationController.applyToCorporation);
router.post('/corporation/cancel-application', corporationController.cancelApplication);
router.post('/corporation/create', corporationController.createCorporation);

module.exports = router;
