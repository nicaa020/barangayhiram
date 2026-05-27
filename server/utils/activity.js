'use strict';

const db = require('../database/db');

function logActivity(userId, action, details, refs) {
  const recordRefs = refs || {};

  db.run(
    `INSERT INTO activity_logs
     (user_id, borrower_id, equipment_id, transaction_id, return_id, action, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId || null,
      recordRefs.borrower_id || null,
      recordRefs.equipment_id || null,
      recordRefs.transaction_id || null,
      recordRefs.return_id || null,
      action,
      details || null
    ],
    function(err) {
      if (err) console.error('Activity log error:', err.message);
    }
  );
}

module.exports = logActivity;
