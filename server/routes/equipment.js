'use strict';
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');

// ─── GET ALL EQUIPMENT ────────────────────────────────────
// Returns all equipment items
router.get('/', auth, function(req, res) {
  db.all('SELECT * FROM equipment', [], function(err, rows) {
    if (err) {
      return res.status(500).json({ message: err.message });
    }
    return res.status(200).json(rows);
  });
});

// ─── GET SINGLE EQUIPMENT ─────────────────────────────────
// Returns one equipment item by ID
router.get('/:id', auth, function(req, res) {
  db.get(
    'SELECT * FROM equipment WHERE equipment_id = ?',
    [req.params.id],
    function(err, row) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      if (!row) {
        return res.status(404).json({ message: 'Equipment not found.' });
      }
      return res.status(200).json(row);
    }
  );
});

// ─── ADD EQUIPMENT ────────────────────────────────────────
// Adds a new equipment item
router.post('/', auth, function(req, res) {
  const name        = req.body.name;
  const category    = req.body.category;
  const description = req.body.description;
  const quantity    = req.body.quantity || 1;

  if (!name) {
    return res.status(400).json({ message: 'Equipment name is required.' });
  }

  db.run(
    'INSERT INTO equipment (name, category, description, quantity, available_quantity, status) VALUES (?, ?, ?, ?, ?, ?)',
    [name, category, description, quantity, quantity, 'Available'],
    function(err) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      return res.status(200).json({
        message: 'Equipment added successfully!',
        equipment_id: this.lastID
      });
    }
  );
});

// ─── UPDATE EQUIPMENT ─────────────────────────────────────
// Updates an existing equipment item
router.put('/:id', auth, function(req, res) {
  const name        = req.body.name;
  const category    = req.body.category;
  const description = req.body.description;
  const quantity    = req.body.quantity;
  const status      = req.body.status;

  db.run(
    'UPDATE equipment SET name = ?, category = ?, description = ?, quantity = ?, status = ? WHERE equipment_id = ?',
    [name, category, description, quantity, status, req.params.id],
    function(err) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      return res.status(200).json({ message: 'Equipment updated successfully!' });
    }
  );
});

// ─── DELETE EQUIPMENT ─────────────────────────────────────
// Deletes an equipment item
router.delete('/:id', auth, function(req, res) {
  db.run(
    'DELETE FROM equipment WHERE equipment_id = ?',
    [req.params.id],
    function(err) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      return res.status(200).json({ message: 'Equipment deleted successfully!' });
    }
  );
});

module.exports = router;