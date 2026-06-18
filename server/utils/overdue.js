'use strict';

const db = require('../database/db');
const email = require('./email');

function all(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params || [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function get(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params || [], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function run(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params || [], function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function markOverdueRequests() {
  const overdueRequests = await all(
    `SELECT t.transaction_id,
            t.borrower_id,
            t.equipment_id,
            t.due_date,
            b.user_id as borrower_user_id,
            b.full_name as borrower_name,
            u.username as borrower_username,
            u.email as borrower_email,
            e.name as equipment_name
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     LEFT JOIN users u ON b.user_id = u.user_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     WHERE t.status = 'Released'
       AND t.due_date < date('now')`
  );

  const results = {
    checked: overdueRequests.length,
    updated: 0,
    notifications_created: 0
  };

  for (const request of overdueRequests) {
    const update = await run(
      `UPDATE transactions
       SET status = 'Overdue'
       WHERE transaction_id = ?
         AND status = 'Released'`,
      [request.transaction_id]
    );

    if (update.changes === 0) continue;
    results.updated += 1;

    if (!request.borrower_user_id) continue;

    const notificationType = 'overdue_request_' + request.transaction_id;
    const existing = await get(
      'SELECT notification_id FROM notifications WHERE user_id = ? AND type = ? LIMIT 1',
      [request.borrower_user_id, notificationType]
    );

    if (!existing) {
      await run(
        `INSERT INTO notifications (user_id, title, message, type, is_read)
         VALUES (?, ?, ?, ?, 0)`,
        [
          request.borrower_user_id,
          'Overdue borrowed equipment',
          'Request #' + request.transaction_id + ' for ' + request.equipment_name + ' is overdue. Please return the equipment immediately.',
          notificationType
        ]
      );
      results.notifications_created += 1;

      email.sendOverdueEmail({
        full_name: request.borrower_name,
        username: request.borrower_username,
        email: request.borrower_email
      }, request).catch(function(emailErr) {
        console.warn('Unable to send overdue email:', emailErr.message);
      });
    }
  }

  return results;
}

module.exports = {
  markOverdueRequests
};
