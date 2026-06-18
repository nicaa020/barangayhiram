'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');

router.get('/', auth, function(req, res) {
  db.all(
    `SELECT notification_id, title, message, type, is_read, created_at
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC, notification_id DESC`,
    [req.user.user_id],
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.put('/:id/read', auth, function(req, res) {
  db.run(
    `UPDATE notifications
     SET is_read = 1
     WHERE notification_id = ? AND user_id = ?`,
    [req.params.id, req.user.user_id],
    function(err) {
      if (err) return res.status(500).json({ message: err.message });
      if (this.changes === 0) return res.status(404).json({ message: 'Notification not found.' });
      return res.status(200).json({ message: 'Notification marked as read.' });
    }
  );
});

router.put('/read-all', auth, function(req, res) {
  db.run(
    `UPDATE notifications
     SET is_read = 1
     WHERE user_id = ?`,
    [req.user.user_id],
    function(err) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json({ message: 'Notifications marked as read.', updated: this.changes });
    }
  );
});

module.exports = router;
