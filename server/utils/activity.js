'use strict';

const db = require('../database/db');

function logActivity(userId, action, details) {
  db.run(
    'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
    [userId || null, action, details || null],
    function(err) {
      if (err) console.error('Activity log error:', err.message);
    }
  );
}

module.exports = logActivity;
