const express = require('express');
const router = express.Router();
const { createContactMessage } = require('../controllers/contact-us.controller');

router.post('/', createContactMessage);

module.exports = router;
