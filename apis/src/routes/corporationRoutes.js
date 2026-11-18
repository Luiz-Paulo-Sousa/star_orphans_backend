const express = require('express');
const router = express.Router();
const corporationController = require('../controllers/corporationController');

router.get('/corporation/status/:pilotUid', corporationController.getCorporationStatus);
router.get('/corporation/list', corporationController.getActiveCorporations);
router.post('/corporation/apply', corporationController.applyToCorporation);
router.post('/corporation/cancel-application', corporationController.cancelApplication);

module.exports = router;
