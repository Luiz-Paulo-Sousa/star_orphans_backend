const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

router.get('/message-channels', messageController.getMessageChannels);
router.get('/factions', messageController.getFactions);
router.get('/channels/sector-pilots/:pilotUid', messageController.getSectorPilots);
router.get('/messages/:channelUid/:subchannelUid', messageController.getFactionMessages);

// Nova rota POST para envio de mensagens com broadcast por setor
router.post('/messages/broadcast', messageController.sendSectorBroadcastMessage);

module.exports = router;