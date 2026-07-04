const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  listByCategory,
  listFavorites,
  addFavorite,
  removeFavorite,
} = require('../controllers/mood-media.controller');

router.get('/favorites', requireJwtAuth, listFavorites);
router.post('/favorites', requireJwtAuth, addFavorite);
router.delete('/favorites/:trackId', requireJwtAuth, removeFavorite);
router.get('/:category', listByCategory);

module.exports = router;
