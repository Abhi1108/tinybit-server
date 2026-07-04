const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  listCareEvents,
  createCareEvent,
  updateCareEvent,
  deleteCareEvent,
} = require('../controllers/care-events.controller');

router.get('/', requireJwtAuth, listCareEvents);
router.post('/', requireJwtAuth, createCareEvent);
router.patch('/:id', requireJwtAuth, updateCareEvent);
router.delete('/:id', requireJwtAuth, deleteCareEvent);

module.exports = router;
