'use strict';

const bcrypt = require('bcryptjs');
const db = require('./database/db');
const recomputeEquipmentAvailability = require('./utils/availability');

const samplePassword = 'Barangay2026!';
const today = new Date();

function formatDate(offsetDays) {
  const date = new Date(today);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().split('T')[0];
}

function run(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params || [], function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params || [], function(err, row) {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params || [], function(err, rows) {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function renameUser(oldUsername, user) {
  const existingTarget = await get('SELECT user_id FROM users WHERE username = ?', [user.username]);
  if (!existingTarget) {
    await run(
      'UPDATE users SET username = ?, full_name = ?, role = ?, status = ? WHERE username = ?',
      [user.username, user.full_name, user.role, 'Active', oldUsername]
    );
  }
}

async function renameLegacyData() {
  await renameUser('admin.demo', {
    username: 'barangay.admin',
    full_name: 'Barangay Administrator',
    role: 'admin'
  });
  await renameUser('staff.demo', {
    username: 'lending.staff',
    full_name: 'Equipment Lending Staff',
    role: 'staff'
  });
  await renameUser('encoder.demo', {
    username: 'records.encoder',
    full_name: 'Records Encoder',
    role: 'staff'
  });

  const equipmentUpdates = [
    ['Folding Chairs', 'Chairs for barangay meetings, events, and community activities.', 60, 'TEST Folding Chairs'],
    ['Folding Tables', 'Tables for barangay programs and public service activities.', 12, 'TEST Folding Tables'],
    ['Sound System', 'Speaker and microphone set for announcements and events.', 2, 'TEST Sound System'],
    ['Projector', 'Projector for trainings, meetings, and presentations.', 1, 'TEST Projector'],
    ['Tent Canopy', 'Outdoor canopy for barangay activities.', 3, 'TEST Tent Canopy'],
    ['Extension Cord', 'Extension cord set for temporary event power needs.', 8, 'TEST Extension Cord']
  ];

  for (const item of equipmentUpdates) {
    await run(
      'UPDATE equipment SET name = ?, description = ?, quantity = ? WHERE name = ?',
      item
    );
  }

  const borrowerUpdates = [
    ['Juan Dela Cruz', 'Purok 1, Barangay 628, Manila', '09171234567', 'TEST Juan Sample Cruz'],
    ['Maria Santos', 'Purok 2, Barangay 628, Manila', '09181234567', 'TEST Maria Demo Santos'],
    ['Carlos Reyes', 'Purok 3, Barangay 628, Manila', '09191234567', 'TEST Carlos Trial Reyes'],
    ['Ana Lim', 'Purok 4, Barangay 628, Manila', '09201234567', 'TEST Ana Survey Lim'],
    ['Roberto Garcia', 'Purok 5, Barangay 628, Manila', '09211234567', 'TEST Roberto Practice Garcia']
  ];

  for (const person of borrowerUpdates) {
    await run(
      'UPDATE borrowers SET full_name = ?, address = ?, contact_number = ? WHERE full_name = ?',
      person
    );
  }

  const purposeUpdates = [
    ['Community meeting setup', 'TEST DATA - Community meeting setup'],
    ['Barangay survey orientation', 'TEST DATA - Barangay survey orientation'],
    ['Health mission setup', 'TEST DATA - Health mission dry run'],
    ['Barangay presentation', 'TEST DATA - Presentation rehearsal'],
    ['Relief distribution activity', 'TEST DATA - Sample distribution activity']
  ];

  for (const purpose of purposeUpdates) {
    await run('UPDATE transactions SET purpose = ? WHERE purpose = ?', purpose);
  }

  await run(
    'UPDATE returns SET remarks = ? WHERE remarks = ?',
    ['Returned complete.', 'TEST DATA - Returned complete.']
  );

  await run(
    `UPDATE activity_logs
     SET action = ?, details = ?
     WHERE action = ?`,
    [
      'Loaded sample data',
      'Inserted staff accounts, equipment, borrowers, transactions, and returns for barangay evaluation.',
      'Seeded test data'
    ]
  );
}

async function upsertUser(user) {
  const hashed = bcrypt.hashSync(samplePassword, 10);
  const existing = await get('SELECT user_id FROM users WHERE username = ?', [user.username]);

  if (existing) {
    await run(
      'UPDATE users SET password = ?, full_name = ?, role = ?, status = ? WHERE username = ?',
      [hashed, user.full_name, user.role, 'Active', user.username]
    );
    return existing.user_id;
  }

  const result = await run(
    'INSERT INTO users (username, password, full_name, role, status) VALUES (?, ?, ?, ?, ?)',
    [user.username, hashed, user.full_name, user.role, 'Active']
  );
  return result.lastID;
}

async function insertIfMissing(table, keyColumn, keyValue, insertSql, params) {
  const existing = await get(
    `SELECT rowid as id FROM ${table} WHERE ${keyColumn} = ?`,
    [keyValue]
  );

  if (existing) return existing.id;

  const result = await run(insertSql, params);
  return result.lastID;
}

async function seed() {
  await renameLegacyData();

  const users = [
    { username: 'barangay.admin', full_name: 'Barangay Administrator', role: 'admin' },
    { username: 'lending.staff', full_name: 'Equipment Lending Staff', role: 'staff' },
    { username: 'records.encoder', full_name: 'Records Encoder', role: 'staff' }
  ];

  const adminUserId = await upsertUser(users[0]);
  await upsertUser(users[1]);
  await upsertUser(users[2]);

  const equipment = [
    ['Folding Chairs', 'Furniture', 'Chairs for barangay meetings, events, and community activities.', 60],
    ['Folding Tables', 'Furniture', 'Tables for barangay programs and public service activities.', 12],
    ['Sound System', 'Electronics', 'Speaker and microphone set for announcements and events.', 2],
    ['Projector', 'Electronics', 'Projector for trainings, meetings, and presentations.', 1],
    ['Tent Canopy', 'Outdoor', 'Outdoor canopy for barangay activities.', 3],
    ['Extension Cord', 'Electrical', 'Extension cord set for temporary event power needs.', 8]
  ];

  const equipmentIds = {};
  for (const item of equipment) {
    const id = await insertIfMissing(
      'equipment',
      'name',
      item[0],
      'INSERT INTO equipment (name, category, description, quantity, available_quantity, status) VALUES (?, ?, ?, ?, ?, ?)',
      [item[0], item[1], item[2], item[3], item[3], 'Available']
    );
    equipmentIds[item[0]] = id;
  }

  const borrowers = [
    ['Juan Dela Cruz', 'Purok 1, Barangay 628, Manila', '09171234567'],
    ['Maria Santos', 'Purok 2, Barangay 628, Manila', '09181234567'],
    ['Carlos Reyes', 'Purok 3, Barangay 628, Manila', '09191234567'],
    ['Ana Lim', 'Purok 4, Barangay 628, Manila', '09201234567'],
    ['Roberto Garcia', 'Purok 5, Barangay 628, Manila', '09211234567']
  ];

  const borrowerIds = {};
  for (const person of borrowers) {
    const id = await insertIfMissing(
      'borrowers',
      'full_name',
      person[0],
      'INSERT INTO borrowers (full_name, address, contact_number) VALUES (?, ?, ?)',
      person
    );
    borrowerIds[person[0]] = id;
  }

  const transactions = [
    {
      borrower: 'Juan Dela Cruz',
      equipment: 'Folding Chairs',
      quantity: 20,
      purpose: 'Community meeting setup',
      borrowed: formatDate(-1),
      due: formatDate(2),
      status: 'Released'
    },
    {
      borrower: 'Maria Santos',
      equipment: 'Sound System',
      quantity: 1,
      purpose: 'Barangay survey orientation',
      borrowed: formatDate(1),
      due: formatDate(3),
      status: 'Pending'
    },
    {
      borrower: 'Carlos Reyes',
      equipment: 'Tent Canopy',
      quantity: 1,
      purpose: 'Health mission setup',
      borrowed: formatDate(-7),
      due: formatDate(-5),
      status: 'Completed',
      returned: formatDate(-5),
      condition: 'Good',
      remarks: 'Returned complete.'
    },
    {
      borrower: 'Ana Lim',
      equipment: 'Projector',
      quantity: 1,
      purpose: 'Barangay presentation',
      borrowed: formatDate(-4),
      due: formatDate(-1),
      status: 'Approved'
    },
    {
      borrower: 'Roberto Garcia',
      equipment: 'Folding Tables',
      quantity: 4,
      purpose: 'Relief distribution activity',
      borrowed: formatDate(3),
      due: formatDate(5),
      status: 'Pending'
    }
  ];

  const transactionIds = [];
  for (const item of transactions) {
    const existing = await get(
      'SELECT transaction_id FROM transactions WHERE purpose = ? AND borrower_id = ? AND equipment_id = ?',
      [item.purpose, borrowerIds[item.borrower], equipmentIds[item.equipment]]
    );

    let transactionId;
    if (existing) {
      transactionId = existing.transaction_id;
      await run(
        `UPDATE transactions
         SET quantity_borrowed = ?, date_borrowed = ?, due_date = ?, status = ?
         WHERE transaction_id = ?`,
        [item.quantity, item.borrowed, item.due, item.status, transactionId]
      );
    } else {
      const result = await run(
        `INSERT INTO transactions
         (borrower_id, equipment_id, quantity_borrowed, purpose, date_borrowed, due_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          borrowerIds[item.borrower],
          equipmentIds[item.equipment],
          item.quantity,
          item.purpose,
          item.borrowed,
          item.due,
          item.status
        ]
      );
      transactionId = result.lastID;
    }

    transactionIds.push(transactionId);

    if (item.status === 'Completed') {
      const existingReturn = await get(
        'SELECT return_id FROM returns WHERE transaction_id = ?',
        [transactionId]
      );
      if (existingReturn) {
        await run(
          'UPDATE returns SET actual_return_date = ?, condition_on_return = ?, remarks = ? WHERE transaction_id = ?',
          [item.returned, item.condition, item.remarks, transactionId]
        );
      } else {
        await run(
          'INSERT INTO returns (transaction_id, actual_return_date, condition_on_return, remarks) VALUES (?, ?, ?, ?)',
          [transactionId, item.returned, item.condition, item.remarks]
        );
      }
    }
  }

  await run(
    `INSERT INTO activity_logs (user_id, action, details)
     SELECT ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM activity_logs WHERE action = ? AND details = ?
     )`,
    [
      adminUserId,
      'Loaded sample data',
      'Inserted staff accounts, equipment, borrowers, transactions, and returns for barangay evaluation.',
      'Loaded sample data',
      'Inserted staff accounts, equipment, borrowers, transactions, and returns for barangay evaluation.'
    ]
  );

  await Promise.all(equipment.map((item) => new Promise((resolve, reject) => {
    recomputeEquipmentAvailability(equipmentIds[item[0]], (err) => {
      if (err) reject(err);
      else resolve();
    });
  })));

  console.log('Sample data is ready.');
  console.log('Staff login accounts:');
  console.log('  barangay.admin / ' + samplePassword);
  console.log('  lending.staff / ' + samplePassword);
  console.log('  records.encoder / ' + samplePassword);
  console.log('Seeded transactions: ' + transactionIds.length);
}

seed()
  .catch((err) => {
    console.error('Sample data seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
