const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { listCareEvents } = require('../controllers/care-events.controller');

router.get('/', requireJwtAuth, listCareEvents);

module.exports = router;
