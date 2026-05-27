'use strict';

const db = require('../database/db');

function recomputeEquipmentAvailability(equipmentId, callback) {
  const today = new Date().toISOString().split('T')[0];

  db.get('SELECT quantity, status FROM equipment WHERE equipment_id = ?', [equipmentId], function(err, equipment) {
    if (err) return callback(err);
    if (!equipment) return callback(new Error('Equipment not found.'));

    db.get(
      `SELECT COALESCE(SUM(quantity_borrowed), 0) as borrowed_quantity
       FROM transactions
       WHERE equipment_id = ?
         AND status != 'Completed'
         AND date_borrowed <= ?
         AND due_date >= ?`,
      [equipmentId, today, today],
      function(err, row) {
        if (err) return callback(err);

        const borrowedQuantity = row ? row.borrowed_quantity : 0;
        const availableQuantity = Math.max(equipment.quantity - borrowedQuantity, 0);
        const status = equipment.status === 'Under Maintenance'
          ? 'Under Maintenance'
          : (availableQuantity === 0 ? 'Borrowed' : 'Available');

        db.run(
          'UPDATE equipment SET available_quantity = ?, status = ? WHERE equipment_id = ?',
          [availableQuantity, status, equipmentId],
          function(err) {
            if (err) return callback(err);
            callback(null, { available_quantity: availableQuantity, status: status });
          }
        );
      }
    );
  });
}

module.exports = recomputeEquipmentAvailability;
