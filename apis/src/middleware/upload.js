const path = require('path');
const fs = require('fs');
const multer = require('multer');

const uploadsDir = path.resolve(__dirname, '..', 'storage', 'uploads');
const avatarsDir = path.resolve(uploadsDir, 'avatars');

if (!fs.existsSync(avatarsDir)) {
    fs.mkdirSync(avatarsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarsDir),
    filename: (req, file, cb) => {
        const accountId = req.body.account_id || Date.now();
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${accountId}${ext}`);
    }
});

const upload = multer({ storage });
module.exports = upload;