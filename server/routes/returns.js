'use strict';
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const logActivity = require('../utils/activity');

const RETURN_STATUSES = ['Good Condition', 'Damaged', 'Incomplete'];

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function createNotification(userId, title, message, type, callback) {
  db.run(
    `INSERT INTO notifications (user_id, title, message, type, is_read)
     VALUES (?, ?, ?, ?, 0)`,
    [userId, title, message, type || 'return_update'],
    function(err) {
      if (err) return callback(err);
      callback(null, this.lastID);
    }
  );
}

router.get('/', auth, admin, function(req, res) {
  db.all(
    `SELECT r.*,
            t.borrower_id,
            t.equipment_id,
            t.quantity_borrowed,
            t.purpose,
            t.date_borrowed,
            t.due_date,
            t.return_status,
            b.full_name as borrower_name,
            b.borrower_type,
            e.name as equipment_name
     FROM returns r
     JOIN transactions t ON r.transaction_id = t.transaction_id
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     ORDER BY r.created_at DESC`,
    [],
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.get('/:id', auth, admin, function(req, res) {
  db.get(
    `SELECT r.*,
            t.borrower_id,
            t.equipment_id,
            t.quantity_borrowed,
            b.full_name as borrower_name,
            e.name as equipment_name
     FROM returns r
     JOIN transactions t ON r.transaction_id = t.transaction_id
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     WHERE r.return_id = ?`,
    [req.params.id],
    function(err, row) {
      if (err) return res.status(500).json({ message: err.message });
      if (!row) return res.status(404).json({ message: 'Return record not found.' });
      return res.status(200).json(row);
    }
  );
});

router.post('/', auth, admin, function(req, res) {
  const transaction_id = req.body.transaction_id || req.body.request_id;
  const actual_return_date = cleanText(req.body.actual_return_date || req.body.returned_at) || null;
  const returned_quantity = parseInt(req.body.returned_quantity || req.body.quantity_returned, 10);
  const return_condition = cleanText(req.body.return_condition || req.body.condition_on_return || 'Good Condition');
  const penalty_notes = cleanText(req.body.penalty_notes || req.body.remarks);

  if (!transaction_id) {
    return res.status(400).json({ message: 'Transaction ID is required.' });
  }
  if (!actual_return_date) {
    return res.status(400).json({ message: 'Return date is required.' });
  }
  if (actual_return_date < todayDateString()) {
    return res.status(400).json({ message: 'Return date cannot be earlier than today.' });
  }
  if (!Number.isInteger(returned_quantity) || returned_quantity < 1) {
    return res.status(400).json({ message: 'Returned quantity must be greater than 0.' });
  }
  if (!RETURN_STATUSES.includes(return_condition)) {
    return res.status(400).json({ message: 'Invalid return condition selected.' });
  }
  if ((return_condition === 'Damaged' || return_condition === 'Incomplete') && !penalty_notes) {
    return res.status(400).json({ message: 'Remarks are required for damaged or incomplete returns.' });
  }

  db.get(
    `SELECT t.*,
            b.user_id as borrower_user_id,
            b.full_name as borrower_name,
            e.name as equipment_name,
            e.quantity as equipment_quantity,
            e.available_quantity as equipment_available_quantity
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     WHERE t.transaction_id = ?`,
    [transaction_id],
    function(err, transaction) {
    if (err) return res.status(500).json({ message: err.message });
    if (!transaction) return res.status(404).json({ message: 'Transaction not found.' });
    if (transaction.status === 'Returned' || transaction.status === 'Completed') {
      return res.status(400).json({ message: 'This transaction is already returned.' });
    }
    if (transaction.status !== 'Released' && transaction.status !== 'Overdue') {
      return res.status(400).json({ message: 'Only released or overdue equipment can be returned.' });
    }
    if (returned_quantity > Number(transaction.quantity_borrowed || 0)) {
      return res.status(400).json({ message: 'Returned quantity cannot exceed borrowed quantity.' });
    }

    db.get(
      'SELECT COALESCE(SUM(returned_quantity), 0) as total_returned FROM returns WHERE transaction_id = ?',
      [transaction_id],
      function(err, returned) {
        if (err) return res.status(500).json({ message: err.message });
        const previousReturned = Number(returned ? returned.total_returned : 0);
        if (previousReturned + returned_quantity > Number(transaction.quantity_borrowed || 0)) {
          return res.status(400).json({ message: 'Total returned quantity cannot exceed borrowed quantity.' });
        }

        const fullReturn = previousReturned + returned_quantity === Number(transaction.quantity_borrowed || 0);
        const nextStatus = fullReturn ? 'Returned' : transaction.status;

        db.run(
          `INSERT INTO returns
           (transaction_id, actual_return_date, returned_quantity, return_condition, condition_on_return, penalty_notes, remarks, received_by)
           VALUES (?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?)`,
          [transaction_id, actual_return_date, returned_quantity, return_condition, return_condition, penalty_notes, penalty_notes, req.user.user_id],
          function(err) {
            if (err) return res.status(500).json({ message: err.message });
            const return_id = this.lastID;

            db.run(
              `UPDATE equipment
               SET available_quantity = MIN(quantity, available_quantity + ?),
                   status = CASE
                     WHEN MIN(quantity, available_quantity + ?) > 0 AND status = 'Unavailable' THEN 'Available'
                     ELSE status
                   END,
                   updated_at = datetime('now')
               WHERE equipment_id = ?`,
              [returned_quantity, returned_quantity, transaction.equipment_id],
              function(err) {
                if (err) return res.status(500).json({ message: err.message });

                db.run(
                  `UPDATE transactions
                   SET status = ?, returned_at = COALESCE(?, datetime('now')), return_status = ?, processed_by = ?
                   WHERE transaction_id = ?`,
                  [nextStatus, actual_return_date, return_condition, req.user.user_id, transaction_id],
                  function(err) {
                    if (err) return res.status(500).json({ message: err.message });

                    function finish() {
                      logActivity(
                        req.user.user_id,
                        'Processed equipment return',
                        'Return #' + return_id + ': transaction #' + transaction_id + ', quantity ' + returned_quantity + ', condition ' + return_condition,
                        {
                          borrower_id: transaction.borrower_id,
                          equipment_id: transaction.equipment_id,
                          transaction_id: transaction_id,
                          return_id: return_id
                        }
                      );

                      createNotification(
                        transaction.borrower_user_id,
                        fullReturn ? 'Equipment return completed' : 'Partial equipment return recorded',
                        'Return for request #' + transaction_id + ' (' + transaction.equipment_name + ') was recorded by barangay staff.',
                        fullReturn ? 'return_completed' : 'partial_return',
                        function(err) {
                          if (err) return res.status(500).json({ message: 'Return recorded, but notification could not be created: ' + err.message });
                          return res.status(200).json({
                            message: fullReturn ? 'Equipment returned successfully!' : 'Partial return recorded successfully.',
                            return_id: return_id,
                            status: nextStatus,
                            inventory_updated: true
                          });
                        }
                      );
                    }

                    if (return_condition === 'Damaged' || return_condition === 'Incomplete') {
                      db.run(
                        'UPDATE borrowers SET is_flagged = 1, flag_reason = ? WHERE borrower_id = ?',
                        [return_condition + ' return on transaction #' + transaction_id + (penalty_notes ? ': ' + penalty_notes : ''), transaction.borrower_id],
                        function(err) {
                          if (err) return res.status(500).json({ message: err.message });
                          createNotification(
                            transaction.borrower_user_id,
                            'Borrowing account restricted',
                            'Your BarangayHiram borrowing account has been restricted because request #' + transaction_id + ' for ' + transaction.equipment_name + ' was returned as ' + return_condition + '. Reason: ' + penalty_notes + ' Please coordinate with barangay staff to clear the restriction.',
                            'account_restricted',
                            function(err) {
                              if (err) return res.status(500).json({ message: 'Restriction recorded, but notification could not be created: ' + err.message });
                              finish();
                            }
                          );
                        }
                      );
                    } else {
                      finish();
                    }
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

module.exports = router;
