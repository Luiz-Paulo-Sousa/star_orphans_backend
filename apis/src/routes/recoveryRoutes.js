const express = require('express');
const router = express.Router();
const recoveryController = require('../controllers/recoveryController');

router.post('/request-reset', recoveryController.requestReset);
router.post('/validate-code', recoveryController.validateCode);
router.post('/reset-password', recoveryController.resetPassword);

module.exports = router;