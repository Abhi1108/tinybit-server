const express = require('express');
const router = express.Router();
const { listTutorials, listFaqs } = require('../controllers/help.controller');

router.get('/tutorials', listTutorials);
router.get('/faqs', listFaqs);

module.exports = router;
