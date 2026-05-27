'use strict';
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const logActivity = require('../utils/activity');
const recomputeEquipmentAvailability = require('../utils/availability');

// ─── GET ALL RETURNS ──────────────────────────────────────
// Returns all return records
router.get('/', auth, function(req, res) {
  db.all(
    `SELECT r.*,
            t.borrower_id,
            t.equipment_id,
            t.quantity_borrowed,
            t.purpose,
            t.date_borrowed,
            t.due_date,
            b.full_name as borrower_name,
            e.name as equipment_name
     FROM returns r
     JOIN transactions t ON r.transaction_id = t.transaction_id
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     ORDER BY r.created_at DESC`,
    [],
    function(err, rows) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      return res.status(200).json(rows);
    }
  );
});

// ─── GET SINGLE RETURN ────────────────────────────────────
// Returns one return record by ID
router.get('/:id', auth, function(req, res) {
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
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      if (!row) {
        return res.status(404).json({ message: 'Return record not found.' });
      }
      return res.status(200).json(row);
    }
  );
});

// ─── PROCESS A RETURN ─────────────────────────────────────
// Records equipment return and updates availability
router.post('/', auth, function(req, res) {
  const transaction_id      = req.body.transaction_id;
  const actual_return_date  = req.body.actual_return_date;
  const condition_on_return = req.body.condition_on_return || 'Good';
  const remarks             = req.body.remarks;

  if (!transaction_id || !actual_return_date) {
    return res.status(400).json({ message: 'Transaction ID and return date are required.' });
  }

  // Get the transaction details first
  db.get(
    'SELECT * FROM transactions WHERE transaction_id = ?',
    [transaction_id],
    function(err, transaction) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      if (!transaction) {
        return res.status(404).json({ message: 'Transaction not found.' });
      }
      if (transaction.status === 'Completed') {
        return res.status(400).json({ message: 'This transaction is already completed.' });
      }

      // Insert the return record
      db.run(
        `INSERT INTO returns
         (transaction_id, actual_return_date, condition_on_return, remarks)
         VALUES (?, ?, ?, ?)`,
        [transaction_id, actual_return_date, condition_on_return, remarks],
        function(err) {
          if (err) {
            return res.status(500).json({ message: err.message });
          }

          const return_id = this.lastID;

          // Update transaction status to Completed
          db.run(
            'UPDATE transactions SET status = ? WHERE transaction_id = ?',
            ['Completed', transaction_id],
            function(err) {
              if (err) {
                return res.status(500).json({ message: err.message });
              }

              // Get equipment details to update availability
              db.get(
                'SELECT * FROM equipment WHERE equipment_id = ?',
                [transaction.equipment_id],
                function(err, equipment) {
                  if (err) {
                    return res.status(500).json({ message: err.message });
                  }

                  recomputeEquipmentAvailability(
                    transaction.equipment_id,
                    function(err) {
                      if (err) {
                        return res.status(500).json({ message: err.message });
                      }
                      logActivity(
                        req.user.user_id,
                        'Processed equipment return',
                          'Return #' + return_id + ': transaction #' + transaction_id +
                            ', quantity ' + transaction.quantity_borrowed +
                            ', condition ' + condition_on_return,
                            {
                              borrower_id: transaction.borrower_id,
                              equipment_id: transaction.equipment_id,
                              transaction_id: transaction_id,
                              return_id: return_id
                            }
                      );
                      return res.status(200).json({
                        message: 'Equipment returned successfully!',
                        return_id: return_id
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    }
  );
});

module.exports = router;
