const express = require('express');
const router = express.Router();
const corporationController = require('../controllers/corporationController');

router.get('/corporation/status/:pilotUid', corporationController.getCorporationStatus);
router.get('/corporation/list', corporationController.getActiveCorporations);
router.get('/corporation/stations', corporationController.getAvailableStations);
router.post('/corporation/apply', corporationController.applyToCorporation);
router.post('/corporation/cancel-application', corporationController.cancelApplication);
router.post('/corporation/create', corporationController.createCorporation);

// Gestão de Equipes (corporation_teams)
router.get('/corporation/:corpUid/teams', corporationController.getCorporationTeams);
router.post('/corporation/:corpUid/teams', corporationController.createCorporationTeam);
router.delete('/corporation/:corpUid/teams/:teamUid', corporationController.deleteCorporationTeam);

// Gestão de Membros / Admitidos (corporation_members)
router.get('/corporation/:corpUid/members', corporationController.getCorporationMembers);
router.patch('/corporation/:corpUid/members/:pilotUid', corporationController.updateCorporationMember);
router.delete('/corporation/:corpUid/members/:pilotUid', corporationController.removeCorporationMember);

module.exports = router;
