const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const upload = require('../middleware/upload');

router.get('/player-profile', profileController.getPlayerProfile);
router.post('/upload-avatar', upload.single('avatar'), profileController.uploadAvatar);

module.exports = router;