const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

router.get('/message-channels', messageController.getMessageChannels);
router.get('/factions', messageController.getFactions);

// Rota genérica para subcanais/membros (:channelType = 'sector', 'corporation', etc.)
router.get('/channels/members/:channelType/:pilotUid', messageController.getChannelMembers);

// Compatibilidade para a antiga rota de setor
router.get('/channels/sector-pilots/:pilotUid', (req, res) => {
    req.params.channelType = 'sector';
    return messageController.getChannelMembers(req, res);
});

// Setor do piloto
router.get('/channels/pilot-sector/:pilotUid', messageController.getPilotSector);

// Status de mensagens não lidas (DEVE vir antes de :channelUid/:subchannelUid para evitar colisão de parâmetros no Express)
router.get('/messages/unread-status/:pilotUid', messageController.checkUnreadStatus);

// Marcação de mensagens como lidas
router.put('/messages/mark-all-read/:destinationUid', messageController.markAllMessagesAsRead);
router.put('/messages/mark-read/:channelUid/:subchannelUid', messageController.markMessagesAsRead);

router.get('/messages/:channelUid/:subchannelUid', messageController.getFactionMessages);

// Rota genérica POST para envio de mensagens com broadcast (setor, corporação, etc.)
router.post('/messages/broadcast', messageController.sendChannelBroadcastMessage);

// Gerenciamento de Contatos
router.post('/contacts/add', messageController.addContact);
router.delete('/contacts/remove/:pilotUid/:contactUid', messageController.removeContact);

module.exports = router;
