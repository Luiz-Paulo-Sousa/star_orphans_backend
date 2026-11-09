const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

router.get('/message-channels', messageController.getMessageChannels);
router.get('/factions', messageController.getFactions);

// Rota genérica para subcanais/membros (:channelType = 'orbit', 'corporation', etc.)
router.get('/channels/members/:channelType/:pilotUid', messageController.getChannelMembers);

// Rota para pilotos na mesma órbita
router.get('/channels/orbit-pilots/:pilotUid', (req, res) => {
    req.params.channelType = 'orbit';
    return messageController.getChannelMembers(req, res);
});

// Órbita atual do piloto
router.get('/channels/pilot-orbit/:pilotUid', messageController.getPilotOrbit);

// Status de mensagens não lidas (DEVE vir antes de :channelUid/:subchannelUid para evitar colisão de parâmetros no Express)
router.get('/messages/unread-status/:pilotUid', messageController.checkUnreadStatus);

// Marcação de mensagens como lidas
router.put('/messages/mark-all-read/:destinationUid', messageController.markAllMessagesAsRead);
router.put('/messages/mark-read/:channelUid/:subchannelUid', messageController.markMessagesAsRead);

router.get('/messages/:channelUid/:subchannelUid', messageController.getFactionMessages);

// Rota genérica POST para envio de mensagens com broadcast (órbita, corporação, etc.)
router.post('/messages/broadcast', messageController.sendChannelBroadcastMessage);

// Gerenciamento de Contatos
router.post('/contacts/add', messageController.addContact);
router.delete('/contacts/remove/:pilotUid/:contactUid', messageController.removeContact);

module.exports = router;
