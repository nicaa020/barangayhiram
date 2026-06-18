'use strict';
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const logActivity = require('../utils/activity');
const supabaseProfiles = require('../utils/supabaseProfiles');

const BORROWER_TYPES = ['Resident', 'Student', 'Transient'];

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

router.get('/', auth, function(req, res) {
  const filters = [];
  const params = [];
  if (req.user.role === 'borrower') {
    filters.push('b.user_id = ?');
    params.push(req.user.user_id);
  }
  if (req.query.borrower_type) {
    filters.push('b.borrower_type = ?');
    params.push(cleanText(req.query.borrower_type));
  }
  if (req.query.verification_status) {
    filters.push('b.verification_status = ?');
    params.push(cleanText(req.query.verification_status));
  }

  db.all(
    `SELECT b.*, u.username, u.email, u.role, u.status as account_status
     FROM borrowers b
     LEFT JOIN users u ON b.user_id = u.user_id
     ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
     ORDER BY b.created_at DESC`,
    params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.get('/:id', auth, function(req, res) {
  const params = [req.params.id];
  const ownerClause = req.user.role === 'borrower' ? ' AND b.user_id = ?' : '';
  if (req.user.role === 'borrower') params.push(req.user.user_id);
  db.get(
    `SELECT b.*, u.username, u.email, u.status as account_status
     FROM borrowers b
     LEFT JOIN users u ON b.user_id = u.user_id
     WHERE b.borrower_id = ?${ownerClause}`,
    params,
    function(err, row) {
      if (err) return res.status(500).json({ message: err.message });
      if (!row) return res.status(404).json({ message: 'Borrower not found.' });
      return res.status(200).json(row);
    }
  );
});

router.get('/:id/history', auth, function(req, res) {
  const params = [req.params.id];
  const ownerClause = req.user.role === 'borrower' ? ' AND b.user_id = ?' : '';
  if (req.user.role === 'borrower') params.push(req.user.user_id);
  db.all(
    `SELECT t.*, e.name as equipment_name, e.category
     FROM transactions t
     JOIN equipment e ON t.equipment_id = e.equipment_id
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     WHERE t.borrower_id = ?${ownerClause}
     ORDER BY t.created_at DESC`,
    params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.post('/', auth, admin, function(req, res) {
  const full_name = cleanText(req.body.full_name);
  const borrower_type = cleanText(req.body.borrower_type || 'Resident');
  const address = cleanText(req.body.address);
  const contact_number = cleanText(req.body.contact_number);
  const valid_id_reference = cleanText(req.body.valid_id_reference);
  const verification_document = cleanText(req.body.verification_document);

  if (!full_name) return res.status(400).json({ message: 'Borrower name is required.' });
  if (!BORROWER_TYPES.includes(borrower_type)) return res.status(400).json({ message: 'Invalid borrower type selected.' });

  db.run(
    `INSERT INTO borrowers
     (full_name, borrower_type, address, contact_number, valid_id_reference, verification_document, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [full_name, borrower_type, address, contact_number, valid_id_reference, verification_document, 'Approved'],
    function(err) {
      if (err) return res.status(500).json({ message: err.message });
      logActivity(req.user.user_id, 'Registered borrower', full_name, { borrower_id: this.lastID });
      return res.status(200).json({ message: 'Borrower registered successfully!', borrower_id: this.lastID });
    }
  );
});

router.put('/:id', auth, admin, function(req, res) {
  const full_name = cleanText(req.body.full_name);
  const borrower_type = cleanText(req.body.borrower_type || 'Resident');
  const address = cleanText(req.body.address);
  const contact_number = cleanText(req.body.contact_number);
  const valid_id_reference = cleanText(req.body.valid_id_reference);
  const verification_document = cleanText(req.body.verification_document);
  const verification_status = cleanText(req.body.verification_status || 'Approved');
  const verification_notes = cleanText(req.body.verification_notes);
  const is_flagged = req.body.is_flagged ? 1 : 0;
  const flag_reason = cleanText(req.body.flag_reason);

  if (!full_name) return res.status(400).json({ message: 'Borrower name is required.' });
  if (!BORROWER_TYPES.includes(borrower_type)) return res.status(400).json({ message: 'Invalid borrower type selected.' });

  db.run(
    `UPDATE borrowers
     SET full_name = ?, borrower_type = ?, address = ?, contact_number = ?,
         valid_id_reference = ?, verification_document = ?, verification_status = ?,
         verification_notes = ?, is_flagged = ?, flag_reason = ?
     WHERE borrower_id = ?`,
    [full_name, borrower_type, address, contact_number, valid_id_reference, verification_document, verification_status, verification_notes, is_flagged, flag_reason, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ message: err.message });
      if (this.changes === 0) return res.status(404).json({ message: 'Borrower not found.' });
      logActivity(req.user.user_id, 'Updated borrower', full_name + ' (ID #' + req.params.id + ')', { borrower_id: req.params.id });
      return res.status(200).json({ message: 'Borrower updated successfully!' });
    }
  );
});

router.put('/:id/clear-flag', auth, admin, function(req, res) {
  db.run('UPDATE borrowers SET is_flagged = 0, flag_reason = NULL WHERE borrower_id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ message: err.message });
    if (this.changes === 0) return res.status(404).json({ message: 'Borrower not found.' });
    logActivity(req.user.user_id, 'Cleared borrower restriction', 'Borrower ID #' + req.params.id, { borrower_id: req.params.id });
    return res.status(200).json({ message: 'Borrower restriction cleared.' });
  });
});

router.delete('/:id', auth, admin, function(req, res) {
  db.get(
    `SELECT b.*, u.username, u.supabase_auth_user_id
     FROM borrowers b
     LEFT JOIN users u ON b.user_id = u.user_id
     WHERE b.borrower_id = ?`,
    [req.params.id],
    function(err, borrower) {
    if (err) return res.status(500).json({ message: err.message });
    if (!borrower) return res.status(404).json({ message: 'Borrower not found.' });

    db.get(
      `SELECT COUNT(*) as total
       FROM transactions
       WHERE borrower_id = ?
         AND (status IN ('Pending', 'Approved', 'Released', 'Overdue')
           OR (due_date < date('now') AND status = 'Released')
           OR (return_status IN ('Damaged', 'Incomplete') AND ? = 1))`,
      [req.params.id, borrower.is_flagged ? 1 : 0],
      function(err, row) {
        if (err) return res.status(500).json({ message: 'Unable to check borrower records.' });
        if (row.total > 0) {
          return res.status(400).json({ message: 'This borrower cannot be deleted because they have pending, active, overdue, or unsettled borrowed items.' });
        }

        function deleteUserAfterBorrower() {
          if (!borrower.user_id) {
            logActivity(req.user.user_id, 'Deleted borrower', borrower.full_name + ' (ID #' + req.params.id + ')', { borrower_id: req.params.id });
            return res.status(200).json({ message: 'Borrower deleted successfully!' });
          }

          db.run('DELETE FROM borrower_verifications WHERE user_id = ?', [borrower.user_id], function(err) {
            if (err) return res.status(500).json({ message: 'Unable to delete borrower verification records.' });
            db.run('DELETE FROM users WHERE user_id = ?', [borrower.user_id], function(err) {
              if (err) return res.status(500).json({ message: 'Unable to delete linked borrower account.' });
              if (borrower.supabase_auth_user_id) {
                supabaseProfiles.deleteAuthUser(borrower.supabase_auth_user_id);
              }
              logActivity(req.user.user_id, 'Deleted borrower account', borrower.full_name + ' (' + (borrower.username || 'no login') + ')', { borrower_id: req.params.id });
              return res.status(200).json({ message: 'Borrower account deleted successfully!' });
            });
          });
        }

        db.run('DELETE FROM borrowers WHERE borrower_id = ?', [req.params.id], function(err) {
          if (err) return res.status(500).json({ message: err.message });
          deleteUserAfterBorrower();
        });
      }
    );
  });
});

module.exports = router;
