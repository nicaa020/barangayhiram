'use strict';
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const logActivity = require('../utils/activity');

// ─── GET ALL BORROWERS ────────────────────────────────────
// Returns all registered borrowers
router.get('/', auth, function(req, res) {
  db.all('SELECT * FROM borrowers', [], function(err, rows) {
    if (err) {
      return res.status(500).json({ message: err.message });
    }
    return res.status(200).json(rows);
  });
});

// ─── GET SINGLE BORROWER ──────────────────────────────────
// Returns one borrower by ID
router.get('/:id', auth, function(req, res) {
  db.get(
    'SELECT * FROM borrowers WHERE borrower_id = ?',
    [req.params.id],
    function(err, row) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      if (!row) {
        return res.status(404).json({ message: 'Borrower not found.' });
      }
      return res.status(200).json(row);
    }
  );
});

// ─── GET BORROWER TRANSACTION HISTORY ────────────────────
// Returns all transactions of a specific borrower
router.get('/:id/history', auth, function(req, res) {
  db.all(
    `SELECT t.*, e.name as equipment_name, e.category
     FROM transactions t
     JOIN equipment e ON t.equipment_id = e.equipment_id
     WHERE t.borrower_id = ?
     ORDER BY t.created_at DESC`,
    [req.params.id],
    function(err, rows) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      return res.status(200).json(rows);
    }
  );
});

// ─── ADD BORROWER ─────────────────────────────────────────
// Registers a new borrower
router.post('/', auth, function(req, res) {
  const full_name      = req.body.full_name;
  const address        = req.body.address;
  const contact_number = req.body.contact_number;

  if (!full_name) {
    return res.status(400).json({ message: 'Borrower name is required.' });
  }

  db.run(
    'INSERT INTO borrowers (full_name, address, contact_number) VALUES (?, ?, ?)',
    [full_name, address, contact_number],
    function(err) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      logActivity(req.user.user_id, 'Registered borrower', full_name, {
        borrower_id: this.lastID
      });
      return res.status(200).json({
        message: 'Borrower registered successfully!',
        borrower_id: this.lastID
      });
    }
  );
});

// ─── UPDATE BORROWER ──────────────────────────────────────
// Updates borrower information
router.put('/:id', auth, function(req, res) {
  const full_name      = req.body.full_name;
  const address        = req.body.address;
  const contact_number = req.body.contact_number;

  db.run(
    'UPDATE borrowers SET full_name = ?, address = ?, contact_number = ? WHERE borrower_id = ?',
    [full_name, address, contact_number, req.params.id],
    function(err) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'Borrower not found.' });
      }
      logActivity(req.user.user_id, 'Updated borrower', full_name + ' (ID #' + req.params.id + ')', {
        borrower_id: req.params.id
      });
      return res.status(200).json({ message: 'Borrower updated successfully!' });
    }
  );
});

// ─── DELETE BORROWER ──────────────────────────────────────
// Deletes a borrower record
router.delete('/:id', auth, function(req, res) {
  db.get(
    'SELECT * FROM borrowers WHERE borrower_id = ?',
    [req.params.id],
    function(err, borrower) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      if (!borrower) {
        return res.status(404).json({ message: 'Borrower not found.' });
      }

      db.run(
        'DELETE FROM borrowers WHERE borrower_id = ?',
        [req.params.id],
        function(err) {
          if (err) {
            return res.status(500).json({ message: err.message });
          }
          logActivity(req.user.user_id, 'Deleted borrower', borrower.full_name + ' (ID #' + req.params.id + ')', {
            borrower_id: req.params.id
          });
          return res.status(200).json({ message: 'Borrower deleted successfully!' });
        }
      );
    }
  );
});

module.exports = router;
