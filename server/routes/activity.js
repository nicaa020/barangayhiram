'use strict';
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

router.get('/', auth, admin, function(req, res) {
  db.all(
    `SELECT l.log_id,
            l.user_id,
            l.action,
            l.details,
            l.timestamp,
            u.full_name,
            u.username
     FROM activity_logs l
     LEFT JOIN users u ON l.user_id = u.user_id
     ORDER BY l.timestamp DESC
     LIMIT 100`,
    [],
    function(err, rows) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      return res.status(200).json(rows);
    }
  );
});

module.exports = router;
