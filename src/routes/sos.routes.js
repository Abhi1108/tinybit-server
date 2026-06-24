const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { triggerSos } = require('../controllers/sos.controller');

router.post('/trigger', requireJwtAuth, triggerSos);

module.exports = router;
