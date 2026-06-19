'use strict';
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const logActivity = require('../utils/activity');

const CATEGORIES = ['Chairs', 'Tables', 'Tents', 'Sound Systems', 'Projectors', 'Generators', 'Sports Equipment', 'Others'];
const CONDITIONS = ['Good', 'Damaged', 'Under Maintenance'];
const STATUSES = ['Available', 'Borrowed', 'Under Maintenance'];
const LOCATIONS = ['Barangay Hall', 'Storage Room', 'Covered Court', 'Office', 'Equipment Room', 'Others'];

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateEquipment(body) {
  const name = cleanText(body.specific_item_name || body.name);
  const category = cleanText(body.category || 'Others');
  const condition = cleanText(body.condition || 'Good');
  const location = cleanText(body.location || 'Storage Room');
  const description = cleanText(body.description);
  const quantity = parseInt(body.quantity_total || body.quantity || 1, 10);
  const status = cleanText(body.status || 'Available');
  const is_high_value = body.is_high_value ? 1 : 0;

  if (!name) return { error: 'Equipment name is required.' };
  if (!Number.isInteger(quantity) || quantity < 1) return { error: 'Quantity must be at least 1.' };
  if (!CATEGORIES.includes(category)) return { error: 'Invalid equipment category selected.' };
  if (!CONDITIONS.includes(condition)) return { error: 'Invalid equipment condition selected.' };
  if (!LOCATIONS.includes(location)) return { error: 'Invalid equipment location selected.' };
  if (!STATUSES.includes(status)) return { error: 'Invalid equipment status selected.' };

  return { name, category, condition, location, description, quantity, status, is_high_value };
}

function mapEquipment(row) {
  const quantityTotal = Number(row.quantity || 0);
  const quantityAvailable = Number(row.available_quantity || 0);
  const quantityBorrowed = Math.max(quantityTotal - quantityAvailable, 0);

  return Object.assign({}, row, {
    item_id: row.equipment_id,
    specific_item_name: row.name,
    quantity_total: quantityTotal,
    quantity_available: quantityAvailable,
    quantity_borrowed: quantityBorrowed
  });
}

function checkDuplicateEquipment(name, category, excludeId, callback) {
  const params = [name, category];
  let sql = 'SELECT equipment_id FROM equipment WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND category = ?';
  if (excludeId) {
    sql += ' AND equipment_id != ?';
    params.push(excludeId);
  }
  sql += ' LIMIT 1';

  db.get(sql, params, function(err, row) {
    if (err) return callback(err);
    return callback(null, Boolean(row));
  });
}

function equipmentSelectSql(whereSql) {
  return `SELECT e.*,
            COALESCE((
              SELECT SUM(t.quantity_borrowed)
              FROM transactions t
              WHERE t.equipment_id = e.equipment_id
                AND t.status = 'Released'
            ), 0) as active_borrowed_quantity
          FROM equipment e` + whereSql;
}

router.get('/options', auth, function(req, res) {
  return res.status(200).json({
    categories: CATEGORIES,
    conditions: CONDITIONS,
    statuses: STATUSES,
    locations: LOCATIONS
  });
});

router.get('/summary', auth, function(req, res) {
  db.all('SELECT * FROM equipment', [], function(err, rows) {
    if (err) return res.status(500).json({ message: err.message });

    const summary = rows.reduce(function(acc, row) {
      const item = mapEquipment(row);
      acc.total += item.quantity_total;
      acc.available += item.quantity_available;
      acc.borrowed += item.quantity_borrowed;
      if (item.condition === 'Damaged' || item.status === 'Under Maintenance' || item.condition === 'Under Maintenance') {
        acc.damaged_maintenance += item.quantity_total;
      }
      return acc;
    }, { total: 0, available: 0, borrowed: 0, damaged_maintenance: 0 });

    return res.status(200).json(summary);
  });
});

router.get('/', auth, function(req, res) {
  const category = cleanText(req.query.category);
  const status = cleanText(req.query.status);
  const search = '%' + cleanText(req.query.search) + '%';
  const filters = [];
  const params = [];

  if (category) {
    filters.push('category = ?');
    params.push(category);
  }
  if (status) {
    filters.push('status = ?');
    params.push(status);
  }
  if (cleanText(req.query.search)) {
    filters.push('(name LIKE ? OR description LIKE ? OR location LIKE ?)');
    params.push(search, search, search);
  }

  db.all(
    equipmentSelectSql(filters.length ? ' WHERE ' + filters.join(' AND ') : '') + ' ORDER BY e.category, e.name',
    params,
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows.map(mapEquipment));
    }
  );
});

router.get('/:id', auth, function(req, res) {
  db.get(equipmentSelectSql(' WHERE e.equipment_id = ?'), [req.params.id], function(err, row) {
    if (err) return res.status(500).json({ message: err.message });
    if (!row) return res.status(404).json({ message: 'Equipment not found.' });
    return res.status(200).json(mapEquipment(row));
  });
});

router.post('/', auth, admin, function(req, res) {
  const data = validateEquipment(req.body);
  if (data.error) return res.status(400).json({ message: data.error });

  checkDuplicateEquipment(data.name, data.category, null, function(err, exists) {
    if (err) return res.status(500).json({ message: 'Unable to check duplicate equipment.' });
    if (exists) {
      return res.status(400).json({ message: 'This equipment already exists in the same category. Please edit the existing item or use a more specific name.' });
    }

    db.run(
      `INSERT INTO equipment
       (name, category, description, quantity, available_quantity, status, condition, location, is_high_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.name, data.category, data.description, data.quantity, data.quantity, data.status, data.condition, data.location, data.is_high_value],
      function(err) {
        if (err) return res.status(500).json({ message: err.message });
        logActivity(req.user.user_id, 'Added equipment', data.name + ' (quantity: ' + data.quantity + ')', {
          equipment_id: this.lastID
        });
        return res.status(200).json({ message: 'Equipment added successfully!', equipment_id: this.lastID, item_id: this.lastID });
      }
    );
  });
});

router.put('/:id', auth, admin, function(req, res) {
  const data = validateEquipment(req.body);
  if (data.error) return res.status(400).json({ message: data.error });

  db.get('SELECT quantity, available_quantity FROM equipment WHERE equipment_id = ?', [req.params.id], function(err, current) {
    if (err) return res.status(500).json({ message: err.message });
    if (!current) return res.status(404).json({ message: 'Equipment not found.' });

    checkDuplicateEquipment(data.name, data.category, req.params.id, function(err, exists) {
      if (err) return res.status(500).json({ message: 'Unable to check duplicate equipment.' });
      if (exists) {
        return res.status(400).json({ message: 'Another equipment item already uses this name in the same category.' });
      }

      const borrowedQuantity = Math.max(Number(current.quantity || 0) - Number(current.available_quantity || 0), 0);
      if (data.quantity < borrowedQuantity) {
        return res.status(400).json({ message: 'Total quantity cannot be lower than the currently borrowed quantity.' });
      }
      const availableQuantity = Math.max(data.quantity - borrowedQuantity, 0);

      db.run(
        `UPDATE equipment
         SET name = ?, category = ?, description = ?, quantity = ?, available_quantity = ?, status = ?,
             condition = ?, location = ?, is_high_value = ?
         WHERE equipment_id = ?`,
        [data.name, data.category, data.description, data.quantity, availableQuantity, data.status, data.condition, data.location, data.is_high_value, req.params.id],
        function(err) {
          if (err) return res.status(500).json({ message: err.message });
          if (this.changes === 0) return res.status(404).json({ message: 'Equipment not found.' });
          logActivity(req.user.user_id, 'Updated equipment', data.name + ' (ID #' + req.params.id + ')', {
            equipment_id: req.params.id
          });
          return res.status(200).json({ message: 'Equipment updated successfully!' });
        }
      );
    });
  });
});

router.delete('/:id', auth, admin, function(req, res) {
  db.get('SELECT * FROM equipment WHERE equipment_id = ?', [req.params.id], function(err, equipment) {
    if (err) return res.status(500).json({ message: err.message });
    if (!equipment) return res.status(404).json({ message: 'Equipment not found.' });

    db.get(
      `SELECT COUNT(*) as total
       FROM transactions
       WHERE equipment_id = ?`,
      [req.params.id],
      function(err, row) {
        if (err) return res.status(500).json({ message: 'Unable to check equipment usage.' });
        if (row.total > 0) {
          return res.status(400).json({ message: 'This equipment cannot be deleted because it is already linked to a borrowing transaction.' });
        }

        db.run('DELETE FROM equipment WHERE equipment_id = ?', [req.params.id], function(err) {
          if (err) return res.status(500).json({ message: err.message });
          logActivity(req.user.user_id, 'Deleted equipment', equipment.name + ' (ID #' + req.params.id + ')', {
            equipment_id: req.params.id
          });
          return res.status(200).json({ message: 'Equipment deleted successfully!' });
        });
      }
    );
  });
});

module.exports = router;
