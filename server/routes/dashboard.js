'use strict';
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');

// ─── GET DASHBOARD STATS ──────────────────────────────────
// Returns all summary numbers for the dashboard
router.get('/stats', auth, function(req, res) {
  const stats = {};
  const today = new Date().toISOString().split('T')[0];

  // Count total equipment
  db.get('SELECT COUNT(*) as total FROM equipment', [], function(err, row) {
    if (err) return res.status(500).json({ message: err.message });
    stats.total_equipment = row.total;

    // Count available equipment
    db.get('SELECT COUNT(*) as total FROM equipment WHERE status = "Available"', [], function(err, row) {
      if (err) return res.status(500).json({ message: err.message });
      stats.available_equipment = row.total;

      // Count borrowed equipment
      db.get('SELECT COUNT(*) as total FROM equipment WHERE status = "Borrowed"', [], function(err, row) {
        if (err) return res.status(500).json({ message: err.message });
        stats.borrowed_equipment = row.total;

        // Count total borrowers
        db.get('SELECT COUNT(*) as total FROM borrowers', [], function(err, row) {
          if (err) return res.status(500).json({ message: err.message });
          stats.total_borrowers = row.total;

          // Count total transactions
          db.get('SELECT COUNT(*) as total FROM transactions', [], function(err, row) {
            if (err) return res.status(500).json({ message: err.message });
            stats.total_transactions = row.total;

            // Count pending transactions
            db.get('SELECT COUNT(*) as total FROM transactions WHERE status = "Pending"', [], function(err, row) {
              if (err) return res.status(500).json({ message: err.message });
              stats.pending_transactions = row.total;

              // Count active transactions (Approved or Released)
              db.get('SELECT COUNT(*) as total FROM transactions WHERE status IN ("Approved", "Released")', [], function(err, row) {
                if (err) return res.status(500).json({ message: err.message });
                stats.active_transactions = row.total;

                // Count completed transactions
                db.get('SELECT COUNT(*) as total FROM transactions WHERE status = "Completed"', [], function(err, row) {
                  if (err) return res.status(500).json({ message: err.message });
                  stats.completed_transactions = row.total;

                  // Count overdue transactions
                  db.get(
                    'SELECT COUNT(*) as total FROM transactions WHERE due_date < ? AND status != "Completed"',
                    [today],
                    function(err, row) {
                      if (err) return res.status(500).json({ message: err.message });
                      stats.overdue_transactions = row.total;

                      // Return all stats
                      return res.status(200).json(stats);
                    }
                  );
                });
              });
            });
          });
        });
      });
    });
  });
});

// ─── GET RECENT TRANSACTIONS ──────────────────────────────
// Returns the 10 most recent transactions
router.get('/recent', auth, function(req, res) {
  db.all(
    `SELECT t.*,
            b.full_name as borrower_name,
            e.name as equipment_name
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     ORDER BY t.created_at DESC
     LIMIT 10`,
    [],
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

// ─── GET EQUIPMENT UTILIZATION ────────────────────────────
// Returns how many times each equipment has been borrowed
router.get('/utilization', auth, function(req, res) {
  db.all(
    `SELECT e.name,
            e.category,
            e.quantity,
            e.available_quantity,
            e.status,
            COUNT(t.transaction_id) as times_borrowed
     FROM equipment e
     LEFT JOIN transactions t ON e.equipment_id = t.equipment_id
     GROUP BY e.equipment_id
     ORDER BY times_borrowed DESC`,
    [],
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

// ─── GET MONTHLY REPORT ───────────────────────────────────
// Returns transaction counts grouped by month
router.get('/monthly', auth, function(req, res) {
  db.all(
    `SELECT strftime('%Y-%m', date_borrowed) as month,
            COUNT(*) as total_transactions,
            SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status != 'Completed' THEN 1 ELSE 0 END) as ongoing
     FROM transactions
     GROUP BY month
     ORDER BY month DESC
     LIMIT 12`,
    [],
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    } 
  );
});

module.exports = router;