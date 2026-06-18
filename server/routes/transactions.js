'use strict';
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const logActivity = require('../utils/activity');
const recomputeEquipmentAvailability = require('../utils/availability');
const overdue = require('../utils/overdue');
const email = require('../utils/email');

const STATUS_FLOW = {
  Pending: ['Approved', 'Rejected', 'Cancelled'],
  Approved: ['Ready for Release', 'Released', 'Rejected', 'Cancelled'],
  'Ready for Release': ['Released', 'Rejected', 'Cancelled'],
  Released: ['Returned'],
  Overdue: ['Returned'],
  Returned: [],
  Completed: [],
  Rejected: [],
  Cancelled: []
};
const RETURN_STATUSES = ['Good Condition', 'Damaged', 'Incomplete'];

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function truthy(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function createNotification(userId, title, message, type, callback) {
  db.run(
    `INSERT INTO notifications (user_id, title, message, type, is_read)
     VALUES (?, ?, ?, ?, 0)`,
    [userId, title, message, type || 'info'],
    function(err) {
      if (err) return callback(err);
      callback(null, this.lastID);
    }
  );
}

function requestNotificationContent(status, transaction, reason) {
  const requestLabel = 'Request #' + transaction.transaction_id;
  if (status === 'Approved') {
    return {
      title: 'Borrowing request approved',
      message: requestLabel + ' for ' + transaction.equipment_name + ' has been approved. Please wait for staff release instructions.',
      type: 'request_approved'
    };
  }
  if (status === 'Released') {
    return {
      title: 'Equipment released',
      message: requestLabel + ' for ' + transaction.equipment_name + ' has been released. Please return it on or before the expected return date.',
      type: 'equipment_released'
    };
  }
  return {
    title: 'Borrowing request rejected',
    message: requestLabel + ' for ' + transaction.equipment_name + ' was rejected. ' + (reason ? 'Reason: ' + reason : 'Please contact barangay staff for details.'),
    type: 'request_rejected'
  };
}

function resolveBorrower(req, callback) {
  if (req.user.role !== 'borrower') {
    return callback(null, req.body.borrower_id);
  }
  db.get(
    `SELECT b.*, u.status as account_status, u.email_verified_at
     FROM borrowers b
     JOIN users u ON b.user_id = u.user_id
     WHERE b.user_id = ?`,
    [req.user.user_id],
    function(err, borrower) {
      if (err) return callback(err);
      if (!borrower) return callback(new Error('Borrower profile not found.'));
      if (!borrower.email_verified_at) return callback(new Error('Please verify your email before submitting borrowing requests.'));
      if (!['Approved', 'Active'].includes(borrower.account_status)) return callback(new Error('Your account must be approved before borrowing.'));
      if (borrower.verification_status !== 'Approved') return callback(new Error('Your account must be approved before borrowing.'));
      if (borrower.is_flagged) return callback(new Error('Your account is restricted from borrowing. Please contact the barangay office.'));
      return callback(null, borrower.borrower_id, borrower);
    }
  );
}

function visibleTransactionWhere(req) {
  if (req.user.role !== 'borrower') return { sql: '', params: [] };
  return {
    sql: ' WHERE b.user_id = ?',
    params: [req.user.user_id]
  };
}

function transactionSelect(whereSql) {
  return `SELECT t.*,
            t.transaction_id as request_id,
            t.quantity_borrowed as quantity,
            t.date_borrowed as borrow_date,
            t.due_date as return_date,
            t.event_location,
            CASE WHEN t.status = 'Released' AND t.due_date < date('now') THEN 'Overdue' ELSE t.status END as display_status,
            rs.full_name as released_by_name,
            ps.full_name as processed_by_name,
            b.full_name as borrower_name,
            b.address as borrower_address,
            b.contact_number as borrower_contact,
            b.borrower_type,
            b.verification_status,
            e.name as equipment_name,
            e.category as equipment_category,
            e.condition as equipment_condition,
            e.location as equipment_location
          FROM transactions t
          JOIN borrowers b ON t.borrower_id = b.borrower_id
          JOIN equipment e ON t.equipment_id = e.equipment_id
          LEFT JOIN users rs ON t.released_by = rs.user_id
          LEFT JOIN users ps ON t.processed_by = ps.user_id` + whereSql;
}

router.get('/', auth, function(req, res) {
  const visible = visibleTransactionWhere(req);
  const filters = [];
  const params = visible.params.slice();

  if (req.query.status) {
    filters.push('t.status = ?');
    params.push(cleanText(req.query.status));
  }
  if (req.query.category) {
    filters.push('e.category = ?');
    params.push(cleanText(req.query.category));
  }
  if (req.query.borrower_type) {
    filters.push('b.borrower_type = ?');
    params.push(cleanText(req.query.borrower_type));
  }
  if (req.query.date_from) {
    filters.push('t.date_borrowed >= ?');
    params.push(cleanText(req.query.date_from));
  }
  if (req.query.date_to) {
    filters.push('t.date_borrowed <= ?');
    params.push(cleanText(req.query.date_to));
  }

  const glue = visible.sql ? ' AND ' : ' WHERE ';
  const sql = transactionSelect(visible.sql + (filters.length ? glue + filters.join(' AND ') : '')) + ' ORDER BY t.created_at DESC';
  db.all(sql, params, function(err, rows) {
    if (err) return res.status(500).json({ message: err.message });
    return res.status(200).json(rows);
  });
});

router.post('/overdue/sync', auth, admin, function(req, res) {
  overdue.markOverdueRequests()
    .then(function(result) {
      return res.status(200).json({
        message: 'Overdue request detection completed.',
        checked: result.checked,
        updated: result.updated,
        notifications_created: result.notifications_created,
        inventory_updated: false
      });
    })
    .catch(function(err) {
      return res.status(500).json({ message: err.message });
    });
});

router.get('/:id', auth, function(req, res) {
  const visible = visibleTransactionWhere(req);
  const where = visible.sql ? visible.sql + ' AND t.transaction_id = ?' : ' WHERE t.transaction_id = ?';
  db.get(transactionSelect(where), visible.params.concat([req.params.id]), function(err, row) {
    if (err) return res.status(500).json({ message: err.message });
    if (!row) return res.status(404).json({ message: 'Transaction not found.' });
    return res.status(200).json(row);
  });
});

function cancelBorrowingRequest(req, res) {
  if (req.user.role !== 'borrower') {
    return res.status(403).json({ message: 'Only borrowers can cancel their own requests from the borrower portal.' });
  }

  db.get(
    `SELECT t.*, b.user_id as borrower_user_id, e.name as equipment_name
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     WHERE t.transaction_id = ? AND b.user_id = ?`,
    [req.params.id, req.user.user_id],
    function(err, transaction) {
      if (err) return res.status(500).json({ message: err.message });
      if (!transaction) return res.status(404).json({ message: 'Request not found.' });

      const cancellableStatuses = ['Pending', 'Approved', 'Ready for Release'];
      if (!cancellableStatuses.includes(transaction.status)) {
        return res.status(400).json({
          message: 'Only pending, approved, or ready-for-release requests can be cancelled before equipment is released.'
        });
      }

      db.run(
        `UPDATE transactions
         SET status = 'Cancelled',
             rejection_reason = COALESCE(NULLIF(?, ''), 'Cancelled by borrower')
         WHERE transaction_id = ?`,
        [cleanText(req.body.reason), req.params.id],
        function(err) {
          if (err) return res.status(500).json({ message: err.message });
          logActivity(req.user.user_id, 'Cancelled borrowing request', 'Request #' + req.params.id + ': ' + transaction.equipment_name, {
            borrower_id: transaction.borrower_id,
            equipment_id: transaction.equipment_id,
            transaction_id: req.params.id
          });
          createNotification(
            transaction.borrower_user_id,
            'Borrowing request cancelled',
            'Request #' + req.params.id + ' for ' + transaction.equipment_name + ' has been cancelled.',
            'request_cancelled',
            function(err) {
              if (err) return res.status(500).json({ message: 'Request cancelled, but notification could not be created: ' + err.message });
              return res.status(200).json({
                message: 'Borrowing request cancelled successfully.',
                status: 'Cancelled',
                inventory_updated: false
              });
            }
          );
        }
      );
    }
  );
}

router.put('/cancel/:id', auth, cancelBorrowingRequest);
router.put('/:id/cancel', auth, cancelBorrowingRequest);

router.post('/', auth, function(req, res) {
  const equipment_id = req.body.equipment_id;
  const quantity_borrowed = parseInt(req.body.quantity || req.body.quantity_borrowed || 1, 10);
  const purpose = cleanText(req.body.purpose);
  const event_location = cleanText(req.body.event_location);
  const date_borrowed = cleanText(req.body.borrow_date || req.body.date_borrowed);
  const due_date = cleanText(req.body.return_date || req.body.due_date);

  if (!equipment_id || !date_borrowed || !due_date || !purpose || !event_location) {
    return res.status(400).json({ message: 'Please fill in all required borrowing fields.' });
  }
  if (!Number.isInteger(quantity_borrowed) || quantity_borrowed < 1) {
    return res.status(400).json({ message: 'Quantity must be at least 1.' });
  }
  if (due_date < date_borrowed) {
    return res.status(400).json({ message: 'Return date cannot be earlier than borrow date.' });
  }

  resolveBorrower(req, function(err, borrower_id) {
    if (err) return res.status(400).json({ message: err.message });
    if (!borrower_id) return res.status(400).json({ message: 'Borrower is required.' });

    db.get(
      `SELECT b.*, u.status as account_status, u.email_verified_at
       FROM borrowers b
       LEFT JOIN users u ON b.user_id = u.user_id
       WHERE b.borrower_id = ?`,
      [borrower_id],
      function(err, borrower) {
        if (err) return res.status(500).json({ message: err.message });
        if (!borrower) return res.status(404).json({ message: 'Borrower not found.' });
        if (!borrower.email_verified_at) {
          return res.status(400).json({ message: 'Borrower must verify their email before borrowing.' });
        }
        if (borrower.account_status && !['Approved', 'Active'].includes(borrower.account_status)) {
          return res.status(400).json({ message: 'Borrower account must be approved before borrowing.' });
        }
        if (borrower.verification_status !== 'Approved') {
          return res.status(400).json({ message: 'Borrower must be approved before borrowing.' });
        }
        if (borrower.is_flagged) {
          return res.status(400).json({ message: 'Borrower is restricted from borrowing until cleared by admin.' });
        }

        db.get(
          `SELECT COUNT(*) as total
           FROM transactions
           WHERE borrower_id = ?
             AND (status = 'Overdue'
               OR (due_date < date('now') AND status = 'Released'))`,
          [borrower_id],
          function(err, active) {
            if (err) return res.status(500).json({ message: err.message });
            if (active.total > 0) {
              return res.status(400).json({ message: 'Borrower cannot submit a new request while they have overdue or unsettled borrowed items.' });
            }

            db.get('SELECT * FROM equipment WHERE equipment_id = ?', [equipment_id], function(err, equipment) {
              if (err) return res.status(500).json({ message: err.message });
              if (!equipment) return res.status(404).json({ message: 'Equipment not found.' });
              if (equipment.status === 'Under Maintenance' || equipment.condition === 'Under Maintenance') {
                return res.status(400).json({ message: 'This equipment is under maintenance and cannot be borrowed.' });
              }

              db.get(
                `SELECT COALESCE(SUM(quantity_borrowed), 0) as reserved_quantity
                 FROM transactions
                 WHERE equipment_id = ?
                   AND status IN ('Pending', 'Approved', 'Released', 'Overdue')
                   AND NOT (due_date < ? OR date_borrowed > ?)`,
                [equipment_id, date_borrowed, due_date],
                function(err, reservation) {
                  if (err) return res.status(500).json({ message: err.message });
                  const reservedQuantity = reservation ? reservation.reserved_quantity : 0;
                  if (reservedQuantity + quantity_borrowed > equipment.quantity) {
                    return res.status(400).json({
                      message: 'Schedule conflict: only ' + Math.max(equipment.quantity - reservedQuantity, 0) + ' available for the selected date range.'
                    });
                  }

                  db.run(
                    `INSERT INTO transactions
                     (borrower_id, equipment_id, quantity_borrowed, purpose, event_location, date_borrowed, due_date, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [borrower_id, equipment_id, quantity_borrowed, purpose, event_location, date_borrowed, due_date, 'Pending'],
                    function(err) {
                      if (err) return res.status(500).json({ message: err.message });
                      const transaction_id = this.lastID;
                      logActivity(req.user.user_id, 'Submitted borrowing request', 'Request #' + transaction_id + ': ' + quantity_borrowed + ' ' + equipment.name, {
                        borrower_id: borrower_id,
                        equipment_id: equipment_id,
                        transaction_id: transaction_id
                      });
                      return res.status(200).json({
                        message: 'Borrowing request submitted successfully!',
                        transaction_id: transaction_id,
                        request_id: transaction_id,
                        status: 'Pending'
                      });
                    }
                  );
                }
              );
            });
          }
        );
      }
    );
  });
});

router.put('/:id', auth, admin, function(req, res) {
  const status = cleanText(req.body.status);
  const reason = cleanText(req.body.reason || req.body.admin_remarks || req.body.remarks);
  if (!status) return res.status(400).json({ message: 'Status is required.' });

  db.get(
    `SELECT t.*, b.user_id as borrower_user_id, b.full_name as borrower_name,
            u.username as borrower_username, u.email as borrower_email,
            e.name as equipment_name, e.quantity as equipment_quantity,
            e.available_quantity as equipment_available_quantity
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     LEFT JOIN users u ON b.user_id = u.user_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     WHERE t.transaction_id = ?`,
    [req.params.id],
    function(err, transaction) {
    if (err) return res.status(500).json({ message: err.message });
    if (!transaction) return res.status(404).json({ message: 'Transaction not found.' });
    const allowed = STATUS_FLOW[transaction.status] || [];
    if (transaction.status === status) {
      return res.status(400).json({ message: 'Borrowing request is already ' + status + '.' });
    }
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: 'Invalid status change from ' + transaction.status + ' to ' + status + '.' });
    }
    if (status === 'Rejected' && !reason) {
      return res.status(400).json({ message: 'Admin remarks are required when rejecting a request.' });
    }

    const fields = ['status = ?'];
    const params = [status];
    if (status === 'Rejected') {
      fields.push('rejection_reason = ?');
      params.push(reason || 'Rejected by admin');
    }
    if (status === 'Released') {
      const identityVerified = truthy(req.body.identity_verified);
      const releaseQuantity = parseInt(req.body.release_quantity || req.body.quantity_released || transaction.quantity_borrowed, 10);
      const releaseCondition = cleanText(req.body.release_condition);
      if (!identityVerified) {
        return res.status(400).json({ message: 'Borrower identity must be manually verified before release.' });
      }
      if (!Number.isInteger(releaseQuantity) || releaseQuantity < 1) {
        return res.status(400).json({ message: 'Released equipment quantity must be at least 1.' });
      }
      if (releaseQuantity !== Number(transaction.quantity_borrowed)) {
        return res.status(400).json({ message: 'Released quantity must match the approved request quantity.' });
      }
      if (!releaseCondition) {
        return res.status(400).json({ message: 'Release condition is required.' });
      }
      fields.push('release_date = COALESCE(?, date("now"))', 'release_quantity = ?', 'release_condition = ?', 'identity_verified = ?', 'released_by = ?');
      params.push(cleanText(req.body.release_date) || null, releaseQuantity, releaseCondition, 1, req.user.user_id);
    }
    if (status === 'Returned') {
      return res.status(400).json({
        message: 'Please process equipment returns through the return endpoint so returned quantity and inventory are recorded correctly.'
      });
    }
    params.push(req.params.id);

    function applyStatusUpdate() {
      db.run('UPDATE transactions SET ' + fields.join(', ') + ' WHERE transaction_id = ?', params, function(err) {
        if (err) return res.status(500).json({ message: err.message });

        function finish(extraMessage) {
          const actionLabels = {
            Approved: 'Approved borrowing request',
            Rejected: 'Rejected borrowing request',
            Released: 'Released equipment',
            Returned: 'Recorded equipment return'
          };
          logActivity(req.user.user_id, actionLabels[status] || 'Updated borrowing status', 'Transaction #' + req.params.id + ': ' + transaction.status + ' to ' + status, {
            transaction_id: req.params.id,
            borrower_id: transaction.borrower_id,
            equipment_id: transaction.equipment_id
          });
          if (status === 'Approved' || status === 'Rejected' || status === 'Released') {
            const notification = requestNotificationContent(status, transaction, reason);
            createNotification(transaction.borrower_user_id, notification.title, notification.message, notification.type, function(err) {
              if (err) return res.status(500).json({ message: 'Status updated, but notification could not be created: ' + err.message });
              email.sendRequestStatusEmail({
                full_name: transaction.borrower_name,
                username: transaction.borrower_username,
                email: transaction.borrower_email
              }, transaction, status, reason).catch(function(emailErr) {
                console.warn('Unable to send request status email:', emailErr.message);
              });
              return res.status(200).json({
                message: extraMessage || ('Borrowing status updated to ' + status),
                status: status,
                inventory_updated: status === 'Released'
              });
            });
            return;
          }
          return res.status(200).json({ message: extraMessage || ('Borrowing status updated to ' + status), status: status });
        }

        if (status === 'Released') {
          db.run(
            `INSERT INTO releases
             (request_id, transaction_id, staff_user_id, release_date, quantity_released, condition_before_release, identity_verified, remarks)
             VALUES (?, ?, ?, COALESCE(?, date("now")), ?, ?, ?, ?)`,
            [
              req.params.id,
              req.params.id,
              req.user.user_id,
              cleanText(req.body.release_date) || null,
              parseInt(req.body.release_quantity || req.body.quantity_released || transaction.quantity_borrowed, 10),
              cleanText(req.body.release_condition),
              1,
              cleanText(req.body.release_remarks)
            ],
            function(err) {
              if (err) return res.status(500).json({ message: err.message });
              const releaseQuantity = parseInt(req.body.release_quantity || req.body.quantity_released || transaction.quantity_borrowed, 10);
              db.run(
                `UPDATE equipment
                 SET available_quantity = available_quantity - ?,
                     status = CASE WHEN available_quantity - ? <= 0 THEN 'Unavailable' ELSE status END,
                     updated_at = datetime('now')
                 WHERE equipment_id = ? AND available_quantity >= ?`,
                [releaseQuantity, releaseQuantity, transaction.equipment_id, releaseQuantity],
                function(err) {
                  if (err) return res.status(500).json({ message: err.message });
                  if (this.changes === 0) {
                    return res.status(400).json({ message: 'Not enough available quantity to release this equipment.' });
                  }
                  finish('Equipment released successfully.');
                }
              );
            }
          );
          return;
        }

        if (status === 'Returned') {
          const returnStatus = cleanText(req.body.return_status || 'Good Condition');
          db.run(
            `INSERT INTO returns
             (transaction_id, actual_return_date, condition_on_return, remarks)
             VALUES (?, COALESCE(?, date("now")), ?, ?)`,
            [req.params.id, cleanText(req.body.returned_at || req.body.actual_return_date) || null, returnStatus, cleanText(req.body.return_remarks || req.body.remarks)],
            function(err) {
              if (err) return res.status(500).json({ message: err.message });
              const returnId = this.lastID;
              function recomputeAndFinish() {
                recomputeEquipmentAvailability(transaction.equipment_id, function(err) {
                  if (err) return res.status(500).json({ message: err.message });
                  finish('Equipment return recorded successfully.');
                });
              }
              if (returnStatus === 'Damaged' || returnStatus === 'Incomplete') {
                db.run(
                  'UPDATE borrowers SET is_flagged = 1, flag_reason = ? WHERE borrower_id = ?',
                  [returnStatus + ' return on transaction #' + req.params.id + ' / return #' + returnId, transaction.borrower_id],
                  function(err) {
                    if (err) return res.status(500).json({ message: err.message });
                    recomputeAndFinish();
                  }
                );
              } else {
                recomputeAndFinish();
              }
            }
          );
          return;
        }

        finish();
      });
    }

    if (status === 'Approved') {
      db.get(
        `SELECT COALESCE(SUM(quantity_borrowed), 0) as reserved_quantity
         FROM transactions
         WHERE equipment_id = ?
           AND transaction_id != ?
           AND status IN ('Approved', 'Released')
           AND NOT (due_date < ? OR date_borrowed > ?)`,
        [transaction.equipment_id, req.params.id, transaction.date_borrowed, transaction.due_date],
        function(err, reservation) {
          if (err) return res.status(500).json({ message: err.message });
          const reservedQuantity = Number(reservation ? reservation.reserved_quantity : 0);
          const availableForApproval = Number(transaction.equipment_quantity || 0) - reservedQuantity;
          if (Number(transaction.quantity_borrowed || 0) > availableForApproval) {
            return res.status(400).json({
              message: 'Not enough available quantity to approve this request. Only ' + Math.max(availableForApproval, 0) + ' available for the selected date range.'
            });
          }
          applyStatusUpdate();
        }
      );
      return;
    }

    if (status === 'Released') {
      const releaseQuantity = parseInt(req.body.release_quantity || req.body.quantity_released || transaction.quantity_borrowed, 10);
      db.get(
        `SELECT available_quantity
         FROM equipment
         WHERE equipment_id = ?`,
        [transaction.equipment_id],
        function(err, row) {
          if (err) return res.status(500).json({ message: err.message });
          if (!row) return res.status(404).json({ message: 'Equipment not found.' });
          const availableForRelease = Number(row.available_quantity || 0);
          if (releaseQuantity > availableForRelease) {
            return res.status(400).json({
              message: 'Not enough available quantity to release this equipment. Only ' + Math.max(availableForRelease, 0) + ' available.'
            });
          }
          applyStatusUpdate();
        }
      );
      return;
    }

    applyStatusUpdate();
    }
  );
});

router.get('/status/pending', auth, admin, function(req, res) {
  db.all(transactionSelect(" WHERE t.status = 'Pending'") + ' ORDER BY t.created_at DESC', [], function(err, rows) {
    if (err) return res.status(500).json({ message: err.message });
    return res.status(200).json(rows);
  });
});

router.get('/status/overdue', auth, admin, function(req, res) {
  db.all(
    transactionSelect(" WHERE t.due_date < date('now') AND t.status = 'Released'") + ' ORDER BY t.due_date ASC',
    [],
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

module.exports = router;
