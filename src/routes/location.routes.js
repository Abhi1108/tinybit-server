const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { getLocation, upsertLocation } = require('../controllers/location.controller');

router.get('/', requireJwtAuth, getLocation);
router.put('/', requireJwtAuth, upsertLocation);

module.exports = router;
