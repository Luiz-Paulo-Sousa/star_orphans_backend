const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

router.get('/message-channels', messageController.getMessageChannels);
router.get('/factions', messageController.getFactions); // <- Adicione esta linha!
router.get('/api/channels/sector-pilots/:pilotUid', messageController.getSectorPilots);
router.get('/messages/:channelUid/:subchannelUid', messageController.getFactionMessages); // Nova rota de mensagens

module.exports = router;