'use strict';
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');

function one(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params || [], (err, row) => err ? reject(err) : resolve(row || {}));
  });
}

function all(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params || [], (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

router.get('/stats', auth, async function(req, res) {
  try {
    const stats = {};
    stats.total_equipment = (await one('SELECT COALESCE(SUM(quantity), 0) as total FROM equipment')).total;
    stats.available_equipment = (await one('SELECT COALESCE(SUM(available_quantity), 0) as total FROM equipment')).total;
    stats.borrowed_equipment = (await one(
      `SELECT COALESCE(SUM(quantity_borrowed), 0) as total
       FROM transactions
       WHERE status = 'Released'`
    )).total;
    stats.damaged_equipment = (await one(
      `SELECT
         (SELECT COUNT(*) FROM equipment WHERE condition = 'Damaged') +
         (SELECT COUNT(*) FROM transactions WHERE return_status IN ('Damaged', 'Incomplete')) as total`
    )).total;
    stats.under_maintenance_equipment = (await one('SELECT COUNT(*) as total FROM equipment WHERE status = "Under Maintenance" OR condition = "Under Maintenance"')).total;
    stats.total_borrowers = (await one('SELECT COUNT(*) as total FROM borrowers')).total;
    stats.verified_borrowers = (await one('SELECT COUNT(*) as total FROM borrowers WHERE verification_status = "Approved"')).total;
    stats.pending_borrower_verifications = (await one('SELECT COUNT(*) as total FROM borrowers WHERE verification_status = "Pending"')).total;
    stats.total_transactions = (await one('SELECT COUNT(*) as total FROM transactions')).total;
    stats.pending_transactions = (await one('SELECT COUNT(*) as total FROM transactions WHERE status = "Pending"')).total;
    stats.active_transactions = (await one('SELECT COUNT(*) as total FROM transactions WHERE status IN ("Approved", "Released")')).total;
    stats.completed_transactions = (await one('SELECT COUNT(*) as total FROM transactions WHERE status IN ("Returned", "Completed")')).total;
    stats.overdue_transactions = (await one(
      `SELECT COUNT(*) as total
       FROM transactions
       WHERE due_date < date('now') AND status = 'Released'`
    )).total;
    return res.status(200).json(stats);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/recent', auth, function(req, res) {
  db.all(
    `SELECT t.*,
            CASE WHEN t.status = 'Released' AND t.due_date < date('now') THEN 'Overdue' ELSE t.status END as display_status,
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

router.get('/utilization', auth, function(req, res) {
  db.all(
    `SELECT e.name,
            e.category,
            e.quantity,
            e.available_quantity,
            e.condition,
            e.location,
            e.status,
            COUNT(t.transaction_id) as times_borrowed,
            SUM(CASE WHEN t.return_status IN ('Damaged', 'Incomplete') THEN 1 ELSE 0 END) as damaged_returns
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

router.get('/monthly', auth, function(req, res) {
  db.all(
    `SELECT strftime('%Y-%m', date_borrowed) as month,
            COUNT(*) as total_transactions,
            SUM(CASE WHEN status IN ('Returned', 'Completed') THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status NOT IN ('Returned', 'Completed', 'Rejected', 'Cancelled') THEN 1 ELSE 0 END) as ongoing
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

router.get('/borrowed-report', auth, function(req, res) {
  const filters = [];
  const params = [];
  if (req.query.date_from) {
    filters.push('t.date_borrowed >= ?');
    params.push(req.query.date_from);
  }
  if (req.query.date_to) {
    filters.push('t.date_borrowed <= ?');
    params.push(req.query.date_to);
  }
  if (req.query.category) {
    filters.push('e.category = ?');
    params.push(req.query.category);
  }
  if (req.query.borrower_type) {
    filters.push('b.borrower_type = ?');
    params.push(req.query.borrower_type);
  }
  if (req.query.status) {
    filters.push('t.status = ?');
    params.push(req.query.status);
  }

  db.all(
    `SELECT t.transaction_id, t.quantity_borrowed, t.purpose, t.date_borrowed, t.due_date, t.status,
            b.full_name as borrower_name, b.borrower_type,
            e.name as equipment_name, e.category
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
     ORDER BY t.date_borrowed DESC`,
    params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

function reportFilters(query) {
  const filters = [];
  const params = [];
  if (query.date_from) {
    filters.push('t.date_borrowed >= ?');
    params.push(query.date_from);
  }
  if (query.date_to) {
    filters.push('t.date_borrowed <= ?');
    params.push(query.date_to);
  }
  if (query.category) {
    filters.push('e.category = ?');
    params.push(query.category);
  }
  if (query.borrower_type) {
    filters.push('b.borrower_type = ?');
    params.push(query.borrower_type);
  }
  if (query.status) {
    if (query.status === 'Overdue') {
      filters.push("(t.status = 'Overdue' OR (t.status = 'Released' AND t.due_date < date('now')))");
    } else {
      filters.push('t.status = ?');
      params.push(query.status);
    }
  }
  return { filters, params };
}

function reportWhere(query, dateColumn) {
  const filters = [];
  const params = [];
  const dateField = dateColumn || 't.date_borrowed';

  if (query.date_from) {
    filters.push(dateField + ' >= ?');
    params.push(query.date_from);
  }
  if (query.date_to) {
    filters.push(dateField + ' <= ?');
    params.push(query.date_to);
  }
  if (query.category) {
    filters.push('e.category = ?');
    params.push(query.category);
  }
  if (query.borrower_type) {
    filters.push('b.borrower_type = ?');
    params.push(query.borrower_type);
  }
  if (query.status) {
    if (query.status === 'Overdue') {
      filters.push("(t.status = 'Overdue' OR (t.status = 'Released' AND t.due_date < date('now')))");
    } else {
      filters.push('t.status = ?');
      params.push(query.status);
    }
  }

  return {
    where: filters.length ? 'WHERE ' + filters.join(' AND ') : '',
    params: params
  };
}

router.get('/reports/borrowed', auth, function(req, res) {
  const filtered = reportFilters(req.query);
  db.all(
    `SELECT t.transaction_id, t.quantity_borrowed, t.purpose, t.date_borrowed, t.due_date,
            CASE WHEN t.status = 'Released' AND t.due_date < date('now') THEN 'Overdue' ELSE t.status END as status,
            b.full_name as borrower_name, b.borrower_type,
            e.name as equipment_name, e.category
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     ${filtered.filters.length ? 'WHERE ' + filtered.filters.join(' AND ') : ''}
     ORDER BY t.date_borrowed DESC`,
    filtered.params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.get('/reports/borrowed-by-date', auth, function(req, res) {
  const filtered = reportWhere(req.query, 't.date_borrowed');
  db.all(
    `SELECT t.date_borrowed as report_date,
            COUNT(t.transaction_id) as total_requests,
            COALESCE(SUM(t.quantity_borrowed), 0) as total_quantity
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     ${filtered.where}
     GROUP BY t.date_borrowed
     ORDER BY t.date_borrowed DESC`,
    filtered.params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.get('/reports/borrowed-by-category', auth, function(req, res) {
  const filtered = reportWhere(req.query, 't.date_borrowed');
  db.all(
    `SELECT e.category,
            COUNT(t.transaction_id) as total_requests,
            COALESCE(SUM(t.quantity_borrowed), 0) as total_quantity
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     ${filtered.where}
     GROUP BY e.category
     ORDER BY total_quantity DESC, e.category ASC`,
    filtered.params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.get('/reports/most-borrowed-equipment', auth, function(req, res) {
  const filtered = reportWhere(req.query, 't.date_borrowed');
  db.all(
    `SELECT e.equipment_id,
            e.name as equipment_name,
            e.category,
            e.quantity,
            e.available_quantity,
            COUNT(t.transaction_id) as total_requests,
            COALESCE(SUM(t.quantity_borrowed), 0) as total_quantity,
            COUNT(DISTINCT t.borrower_id) as unique_borrowers,
            SUM(CASE WHEN t.status = 'Released' THEN 1 ELSE 0 END) as currently_released,
            SUM(CASE WHEN t.status IN ('Returned', 'Completed') THEN 1 ELSE 0 END) as returned_transactions,
            SUM(CASE WHEN t.status = 'Overdue' OR (t.status = 'Released' AND t.due_date < date('now')) THEN 1 ELSE 0 END) as overdue_transactions
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     ${filtered.where}
     GROUP BY e.equipment_id
     ORDER BY total_quantity DESC, total_requests DESC, e.name ASC`,
    filtered.params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.get('/reports/borrowed-by-borrower-type', auth, function(req, res) {
  const filtered = reportWhere(req.query, 't.date_borrowed');
  db.all(
    `SELECT b.borrower_type,
            COUNT(t.transaction_id) as total_requests,
            COALESCE(SUM(t.quantity_borrowed), 0) as total_quantity
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     ${filtered.where}
     GROUP BY b.borrower_type
     ORDER BY total_quantity DESC, b.borrower_type ASC`,
    filtered.params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.get('/reports/requests-by-status', auth, function(req, res) {
  const filtered = reportWhere(req.query, 't.date_borrowed');
  db.all(
    `SELECT CASE
              WHEN t.status = 'Released' AND t.due_date < date('now') THEN 'Overdue'
              ELSE t.status
            END as status,
            COUNT(t.transaction_id) as total_requests,
            COALESCE(SUM(t.quantity_borrowed), 0) as total_quantity
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     ${filtered.where}
     GROUP BY CASE
                WHEN t.status = 'Released' AND t.due_date < date('now') THEN 'Overdue'
                ELSE t.status
              END
     ORDER BY total_requests DESC, status ASC`,
    filtered.params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.get('/reports/inventory', auth, function(req, res) {
  const filters = [];
  const params = [];
  if (req.query.category) {
    filters.push('e.category = ?');
    params.push(req.query.category);
  }
  if (req.query.status) {
    filters.push('e.status = ?');
    params.push(req.query.status);
  }
  db.all(
    `SELECT e.equipment_id, e.name, e.category, e.quantity, e.available_quantity,
            (e.quantity - e.available_quantity) as borrowed_quantity,
            e.condition, e.location, e.status,
            COUNT(t.transaction_id) as times_borrowed,
            SUM(CASE WHEN t.return_status IN ('Damaged', 'Incomplete') THEN 1 ELSE 0 END) as problem_returns
     FROM equipment e
     LEFT JOIN transactions t ON e.equipment_id = t.equipment_id
     ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
     GROUP BY e.equipment_id
     ORDER BY e.category, e.name`,
    params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.get('/reports/inventory-recapitulation', auth, function(req, res) {
  const filters = [];
  const params = [];
  if (req.query.category) {
    filters.push('category = ?');
    params.push(req.query.category);
  }
  if (req.query.status) {
    filters.push('status = ?');
    params.push(req.query.status);
  }

  db.all(
    `SELECT category,
            COUNT(equipment_id) as item_count,
            COALESCE(SUM(quantity), 0) as total_quantity,
            COALESCE(SUM(available_quantity), 0) as available_quantity,
            COALESCE(SUM(quantity - available_quantity), 0) as borrowed_quantity,
            SUM(CASE WHEN condition IN ('Damaged', 'Under Maintenance') OR status IN ('Damaged', 'Under Maintenance', 'Maintenance') THEN 1 ELSE 0 END) as damaged_or_maintenance_items
     FROM equipment
     ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
     GROUP BY category
     ORDER BY category ASC`,
    params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.get('/reports/borrowers', auth, function(req, res) {
  const filters = [];
  const params = [];
  if (req.query.borrower_type) {
    filters.push('b.borrower_type = ?');
    params.push(req.query.borrower_type);
  }
  if (req.query.status) {
    filters.push('b.verification_status = ?');
    params.push(req.query.status);
  }
  db.all(
    `SELECT b.borrower_id, b.full_name, b.borrower_type, b.address, b.contact_number,
            b.verification_status, b.is_flagged, b.flag_reason,
            COUNT(t.transaction_id) as total_requests,
            SUM(CASE WHEN t.status = 'Released' THEN 1 ELSE 0 END) as active_borrowings,
            SUM(CASE WHEN t.status = 'Released' AND t.due_date < date('now') THEN 1 ELSE 0 END) as overdue_items
     FROM borrowers b
     LEFT JOIN transactions t ON b.borrower_id = t.borrower_id
     ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
     GROUP BY b.borrower_id
     ORDER BY b.full_name`,
    params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.get('/reports/overdue', auth, function(req, res) {
  const filtered = reportFilters(Object.assign({}, req.query, { status: 'Overdue' }));
  db.all(
    `SELECT t.transaction_id, t.quantity_borrowed, t.purpose, t.date_borrowed, t.due_date,
            CAST(julianday(date('now')) - julianday(t.due_date) AS INTEGER) as days_overdue,
            CASE WHEN t.status = 'Overdue' THEN 'Overdue' ELSE t.status END as status,
            b.full_name as borrower_name, b.borrower_type, b.contact_number,
            e.name as equipment_name, e.category
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     ${filtered.filters.length ? 'WHERE ' + filtered.filters.join(' AND ') : ''}
     ORDER BY t.due_date ASC`,
    filtered.params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.get('/reports/release-return-history', auth, function(req, res) {
  const filters = [];
  const params = [];

  if (req.query.date_from) {
    filters.push("COALESCE(r.actual_return_date, rel.release_date, t.date_borrowed) >= ?");
    params.push(req.query.date_from);
  }
  if (req.query.date_to) {
    filters.push("COALESCE(r.actual_return_date, rel.release_date, t.date_borrowed) <= ?");
    params.push(req.query.date_to);
  }
  if (req.query.category) {
    filters.push('e.category = ?');
    params.push(req.query.category);
  }
  if (req.query.borrower_type) {
    filters.push('b.borrower_type = ?');
    params.push(req.query.borrower_type);
  }
  if (req.query.status) {
    filters.push('t.status = ?');
    params.push(req.query.status);
  }

  db.all(
    `SELECT t.transaction_id,
            t.status,
            t.quantity_borrowed,
            t.date_borrowed,
            t.due_date,
            b.full_name as borrower_name,
            b.borrower_type,
            e.name as equipment_name,
            e.category,
            rel.release_id,
            rel.release_date,
            rel.quantity_released,
            rel.condition_before_release,
            rel.remarks as release_remarks,
            release_staff.full_name as released_by_name,
            r.return_id,
            r.actual_return_date,
            r.returned_quantity,
            COALESCE(r.return_condition, r.condition_on_return, r.return_status) as return_condition,
            COALESCE(r.penalty_notes, r.remarks) as penalty_notes,
            return_staff.full_name as received_by_name
     FROM transactions t
     JOIN borrowers b ON t.borrower_id = b.borrower_id
     JOIN equipment e ON t.equipment_id = e.equipment_id
     LEFT JOIN releases rel ON rel.transaction_id = t.transaction_id
     LEFT JOIN users release_staff ON rel.staff_user_id = release_staff.user_id
     LEFT JOIN returns r ON r.transaction_id = t.transaction_id
     LEFT JOIN users return_staff ON COALESCE(r.received_by, t.processed_by) = return_staff.user_id
     ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
     ORDER BY COALESCE(r.actual_return_date, rel.release_date, t.date_borrowed) DESC`,
    params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.get('/reports/activity-logs', auth, function(req, res) {
  const filters = ["u.role IN ('super_admin', 'admin', 'staff')"];
  const params = [];

  if (req.query.date_from) {
    filters.push('date(l.timestamp) >= ?');
    params.push(req.query.date_from);
  }
  if (req.query.date_to) {
    filters.push('date(l.timestamp) <= ?');
    params.push(req.query.date_to);
  }
  if (req.query.action) {
    filters.push('l.action = ?');
    params.push(req.query.action);
  }

  db.all(
    `SELECT l.log_id,
            l.user_id,
            u.full_name as staff_name,
            u.username,
            u.role,
            l.action,
            l.details,
            l.borrower_id,
            b.full_name as borrower_name,
            l.equipment_id,
            e.name as equipment_name,
            l.transaction_id,
            l.return_id,
            l.timestamp
     FROM activity_logs l
     JOIN users u ON l.user_id = u.user_id
     LEFT JOIN borrowers b ON l.borrower_id = b.borrower_id
     LEFT JOIN equipment e ON l.equipment_id = e.equipment_id
     WHERE ${filters.join(' AND ')}
     ORDER BY l.timestamp DESC
     LIMIT 500`,
    params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

module.exports = router;
