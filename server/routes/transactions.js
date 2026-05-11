'use strict';
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');

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
  const quantity_borrowed = req.body.quantity_borrowed || 1;
  const purpose           = req.body.purpose;
  const date_borrowed     = req.body.date_borrowed;
  const due_date          = req.body.due_date;

  if (!borrower_id || !equipment_id || !date_borrowed || !due_date) {
    return res.status(400).json({ message: 'Please fill in all required fields.' });
  }

  // Check if equipment exists and has enough available quantity
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
      if (equipment.available_quantity < quantity_borrowed) {
        return res.status(400).json({
          message: 'Not enough equipment available. Available: ' + equipment.available_quantity
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

          // Update available quantity of equipment
          const new_available = equipment.available_quantity - quantity_borrowed;
          const new_status    = new_available === 0 ? 'Borrowed' : 'Available';

          db.run(
            'UPDATE equipment SET available_quantity = ?, status = ? WHERE equipment_id = ?',
            [new_available, new_status, equipment_id],
            function(err) {
              if (err) {
                return res.status(500).json({ message: err.message });
              }
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
});

// ─── UPDATE TRANSACTION STATUS ────────────────────────────
// Updates the status of a transaction
router.put('/:id', auth, function(req, res) {
  const status = req.body.status;

  if (!status) {
    return res.status(400).json({ message: 'Status is required.' });
  }

  db.run(
    'UPDATE transactions SET status = ? WHERE transaction_id = ?',
    [status, req.params.id],
    function(err) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      return res.status(200).json({ message: 'Transaction status updated to ' + status });
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