const Express = require('express');
const router = Express.Router();
const marketController = require('../controllers/marketController');

router.get('/market/catalog/:pilotUid', marketController.getMarketCatalog);
router.get('/market/catalog', marketController.getMarketCatalog);
router.post('/market/buy', marketController.buyMarketItem);
router.post('/market/sell', marketController.sellMarketItem);
router.post('/market/create-listing', marketController.createPlayerListing);
router.post('/market/cancel-listing', marketController.cancelPlayerListing);

module.exports = router;
