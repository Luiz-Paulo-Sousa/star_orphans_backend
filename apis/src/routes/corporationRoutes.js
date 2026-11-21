const express = require('express');
const router = express.Router();
const corporationController = require('../controllers/corporationController');

router.get('/corporation/status/:pilotUid', corporationController.getCorporationStatus);
router.get('/corporation/list', corporationController.getActiveCorporations);
router.get('/corporation/stations', corporationController.getAvailableStations);
router.post('/corporation/apply', corporationController.applyToCorporation);
router.post('/corporation/cancel-application', corporationController.cancelApplication);
router.post('/corporation/create', corporationController.createCorporation);

// GestÃ£o de Equipes (corporation_teams)
router.get('/corporation/:corpUid/teams', corporationController.getCorporationTeams);
router.post('/corporation/:corpUid/teams', corporationController.createCorporationTeam);
router.delete('/corporation/:corpUid/teams/:teamUid', corporationController.deleteCorporationTeam);

// Gestão de Membros / Admitidos (corporation_members)
router.get('/corporation/:corpUid/members', corporationController.getCorporationMembers);
router.patch('/corporation/:corpUid/members/:pilotUid', corporationController.updateCorporationMember);
router.post('/corporation/:corpUid/members/:pilotUid', corporationController.updateCorporationMember);
router.put('/corporation/:corpUid/members/:pilotUid', corporationController.updateCorporationMember);
router.delete('/corporation/:corpUid/members/:pilotUid', corporationController.removeCorporationMember);

// Movimentação de Itens da Corporação
router.get('/corporation/:corpUid/items', corporationController.getCorporationItems);
router.get('/corporation/:corpUid/member-hangar/:pilotUid', corporationController.getCorporationMemberHangar);
router.post('/corporation/:corpUid/transfer-item', corporationController.transferCorporationItem);
router.get('/corporation/:corpUid/item-transactions', corporationController.getCorporationItemTransactions);

module.exports = router;

