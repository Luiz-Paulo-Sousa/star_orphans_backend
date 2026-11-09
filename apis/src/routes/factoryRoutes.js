const Express = require('express');
const router = Express.Router();
const factoryController = require('../controllers/factoryController');

// Informações da estação atual e status do hangar/créditos
router.get('/factory/info/:pilotUid', factoryController.getStationFactoryInfo);

// Lista de receitas disponíveis na estação atual com disponibilidade de materiais no hangar
router.get('/factory/recipes/:pilotUid', factoryController.getAvailableRecipes);

// Fila de fabricação em andamento do piloto
router.get('/factory/queue/:pilotUid', factoryController.getPilotQueue);

// Inicia a produção de um item
router.post('/factory/start', factoryController.startCrafting);

// Cancela uma produção em andamento
router.post('/factory/cancel', factoryController.cancelCrafting);

module.exports = router;
