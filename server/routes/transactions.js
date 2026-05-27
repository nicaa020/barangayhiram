'use strict';
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const logActivity = require('../utils/activity');
const recomputeEquipmentAvailability = require('../utils/availability');

// ─── GET ALL TRANSACTIONS ─────────────────────────────────
// Returns all transactions with borrower and equipment details
router.get('/', auth, function(req, res) {
  db.all(
    `SELECT t.*,
            b.full_name as borrower_name,
            b.address as borrower_address,
            b.contact_number as borrower_contact,
            e.name as equipment_name,
            e.category as equipment_category
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     ORDER BY t.created_at DESC`,
    [],
    function(err, rows) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      return res.status(200).json(rows);
    }
  );
});

// ─── GET SINGLE TRANSACTION ───────────────────────────────
// Returns one transaction by ID
router.get('/:id', auth, function(req, res) {
  db.get(
    `SELECT t.*,
            b.full_name as borrower_name,
            b.address as borrower_address,
            b.contact_number as borrower_contact,
            e.name as equipment_name,
            e.category as equipment_category
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     WHERE t.transaction_id = ?`,
    [req.params.id],
    function(err, row) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      if (!row) {
        return res.status(404).json({ message: 'Transaction not found.' });
      }
      return res.status(200).json(row);
    }
  );
});

// ─── CREATE TRANSACTION ───────────────────────────────────
// Creates a new borrowing transaction
router.post('/', auth, function(req, res) {
  const borrower_id       = req.body.borrower_id;
  const equipment_id      = req.body.equipment_id;
  const quantity_borrowed = parseInt(req.body.quantity_borrowed || 1, 10);
  const purpose           = req.body.purpose;
  const date_borrowed     = req.body.date_borrowed;
  const due_date          = req.body.due_date;

  if (!borrower_id || !equipment_id || !date_borrowed || !due_date) {
    return res.status(400).json({ message: 'Please fill in all required fields.' });
  }
  if (!Number.isInteger(quantity_borrowed) || quantity_borrowed < 1) {
    return res.status(400).json({ message: 'Quantity must be at least 1.' });
  }
  if (due_date < date_borrowed) {
    return res.status(400).json({ message: 'Due date cannot be earlier than borrowed date.' });
  }

  // Check if equipment exists and has enough quantity for the selected dates
  db.get(
    'SELECT * FROM equipment WHERE equipment_id = ?',
    [equipment_id],
    function(err, equipment) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      if (!equipment) {
        return res.status(404).json({ message: 'Equipment not found.' });
      }
      db.get(
        `SELECT COALESCE(SUM(quantity_borrowed), 0) as reserved_quantity
         FROM transactions
         WHERE equipment_id = ?
           AND status != 'Completed'
           AND NOT (due_date < ? OR date_borrowed > ?)`,
        [equipment_id, date_borrowed, due_date],
        function(err, reservation) {
          if (err) {
            return res.status(500).json({ message: err.message });
          }

          const reservedQuantity = reservation ? reservation.reserved_quantity : 0;
          if (reservedQuantity + quantity_borrowed > equipment.quantity) {
            return res.status(400).json({
              message: 'Schedule conflict: only ' + Math.max(equipment.quantity - reservedQuantity, 0) +
                ' available for the selected date range.'
            });
          }

          // Create the transaction
          db.run(
            `INSERT INTO transactions
             (borrower_id, equipment_id, quantity_borrowed, purpose, date_borrowed, due_date, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [borrower_id, equipment_id, quantity_borrowed, purpose, date_borrowed, due_date, 'Pending'],
            function(err) {
              if (err) {
                return res.status(500).json({ message: err.message });
              }

              const transaction_id = this.lastID;

              recomputeEquipmentAvailability(
                equipment_id,
                function(err) {
                  if (err) {
                    return res.status(500).json({ message: err.message });
                  }
                  logActivity(
                    req.user.user_id,
                    'Created borrowing transaction',
                    'Transaction #' + transaction_id + ': ' + quantity_borrowed + ' ' + equipment.name +
                      ' from ' + date_borrowed + ' to ' + due_date
                  );
                  return res.status(200).json({
                    message: 'Transaction created successfully!',
                    transaction_id: transaction_id
                  });
                }
              );
            }
          );
        }
      );
    }
  );
});

// ─── UPDATE TRANSACTION STATUS ────────────────────────────
// Updates the status of a transaction
router.put('/:id', auth, function(req, res) {
  const status = req.body.status;

  if (!status) {
    return res.status(400).json({ message: 'Status is required.' });
  }

  db.get(
    'SELECT status FROM transactions WHERE transaction_id = ?',
    [req.params.id],
    function(err, transaction) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      if (!transaction) {
        return res.status(404).json({ message: 'Transaction not found.' });
      }

      db.run(
        'UPDATE transactions SET status = ? WHERE transaction_id = ?',
        [status, req.params.id],
        function(err) {
          if (err) {
            return res.status(500).json({ message: err.message });
          }
          logActivity(
            req.user.user_id,
            'Updated transaction status',
            'Transaction #' + req.params.id + ': ' + transaction.status + ' to ' + status
          );
          return res.status(200).json({ message: 'Transaction status updated to ' + status });
        }
      );
    }
  );
});

// ─── GET PENDING TRANSACTIONS ─────────────────────────────
// Returns all pending transactions
router.get('/status/pending', auth, function(req, res) {
  db.all(
    `SELECT t.*,
            b.full_name as borrower_name,
            e.name as equipment_name
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     WHERE t.status = 'Pending'
     ORDER BY t.created_at DESC`,
    [],
    function(err, rows) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      return res.status(200).json(rows);
    }
  );
});

// ─── GET OVERDUE TRANSACTIONS ─────────────────────────────
// Returns all overdue transactions
router.get('/status/overdue', auth, function(req, res) {
  const today = new Date().toISOString().split('T')[0];

  db.all(
    `SELECT t.*,
            b.full_name as borrower_name,
            b.contact_number as borrower_contact,
            e.name as equipment_name
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     WHERE t.due_date < ? AND t.status != 'Completed'
     ORDER BY t.due_date ASC`,
    [today],
    function(err, rows) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      return res.status(200).json(rows);
    }
  );
});

module.exports = router;
