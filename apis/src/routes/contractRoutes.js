const express = require('express');
const router = express.Router();
const contractController = require('../controllers/contractController');

// Consultas
router.get('/contracts/available', contractController.getAvailableContracts);
router.get('/contracts/active/:pilotUid', contractController.getActiveContracts);
router.get('/contracts/issuer/:pilotUid', contractController.getIssuerContracts);

// Gestão de Contratos (Contratante)
router.post('/contracts/create', contractController.createContract);
router.put('/contracts/:contractUid', contractController.editContract);
router.post('/contracts/:contractUid/edit', contractController.editContract);
router.post('/contracts/:contractUid/cancel', contractController.cancelContract);
router.delete('/contracts/:contractUid', contractController.cancelContract);
router.post('/contracts/:contractUid/reactivate', contractController.reactivateContract);
router.post('/contracts/:contractUid/clone', contractController.cloneContract);

// Ações do Contratado
router.post('/contracts/:contractUid/accept', contractController.acceptContract);
router.post('/contracts/:contractUid/deliver', contractController.deliverContract);
router.post('/contracts/:contractUid/abandon', contractController.abandonContract);

module.exports = router;
