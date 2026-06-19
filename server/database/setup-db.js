'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const dbPath = process.env.DB_PATH || './barangayhiram.db';
const schemaPath = path.join(__dirname, 'schema.sql');

const db = new sqlite3.Database(dbPath);

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

function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function tableColumns(tableName) {
  return new Promise((resolve, reject) => {
    db.all('PRAGMA table_info(' + tableName + ')', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map((row) => row.name));
    });
  });
}

async function ensureColumn(tableName, columnName, definition) {
  const columns = await tableColumns(tableName);
  if (!columns.includes(columnName)) {
    await run('ALTER TABLE ' + tableName + ' ADD COLUMN ' + columnName + ' ' + definition);
  }
}

async function patchLegacyTables() {
  await ensureColumn('users', 'email', 'TEXT');
  await ensureColumn('users', 'contact_number', 'TEXT');
  await ensureColumn('users', 'borrower_type', 'TEXT');
  await ensureColumn('users', 'updated_at', 'TEXT');

  await ensureColumn('equipment', 'condition', 'TEXT DEFAULT "Good"');
  await ensureColumn('equipment', 'location', 'TEXT');
  await ensureColumn('equipment', 'updated_at', 'TEXT');

  await ensureColumn('borrowers', 'user_id', 'INTEGER');
  await ensureColumn('borrowers', 'first_name', 'TEXT');
  await ensureColumn('borrowers', 'last_name', 'TEXT');
  await ensureColumn('borrowers', 'borrower_type', 'TEXT DEFAULT "Resident"');
  await ensureColumn('borrowers', 'address', 'TEXT');
  await ensureColumn('borrowers', 'contact_number', 'TEXT');
  await ensureColumn('borrowers', 'valid_id_reference', 'TEXT');
  await ensureColumn('borrowers', 'verification_document', 'TEXT');
  await ensureColumn('borrowers', 'verification_status', 'TEXT DEFAULT "Approved"');
  await ensureColumn('borrowers', 'verification_notes', 'TEXT');

  await ensureColumn('borrower_verifications', 'notes', 'TEXT');
  await ensureColumn('borrower_verifications', 'reviewed_by', 'INTEGER');
  await ensureColumn('borrower_verifications', 'reviewed_at', 'TEXT');

  await ensureColumn('returns', 'request_id', 'INTEGER');
  await ensureColumn('returns', 'release_id', 'INTEGER');
  await ensureColumn('returns', 'processed_by', 'INTEGER');
  await ensureColumn('returns', 'return_status', 'TEXT DEFAULT "Good Condition"');
  await ensureColumn('returns', 'returned_quantity', 'INTEGER');
  await ensureColumn('returns', 'return_condition', 'TEXT');
  await ensureColumn('returns', 'penalty_notes', 'TEXT');
  await ensureColumn('returns', 'received_by', 'INTEGER');

  await ensureColumn('releases', 'request_id', 'INTEGER');
  await ensureColumn('releases', 'transaction_id', 'INTEGER');
  await ensureColumn('releases', 'staff_user_id', 'INTEGER');
  await ensureColumn('releases', 'release_date', 'TEXT');
  await ensureColumn('releases', 'quantity_released', 'INTEGER');
  await ensureColumn('releases', 'condition_before_release', 'TEXT');
  await ensureColumn('releases', 'identity_verified', 'INTEGER DEFAULT 0');
  await ensureColumn('releases', 'remarks', 'TEXT');

  await ensureColumn('activity_logs', 'entity_type', 'TEXT');
  await ensureColumn('activity_logs', 'entity_id', 'INTEGER');

  await run('CREATE INDEX IF NOT EXISTS idx_releases_request ON releases(request_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_returns_request ON returns(request_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON activity_logs(entity_type, entity_id)');
}

async function seedSuperAdmin() {
  const username = process.env.SUPER_ADMIN_USERNAME || 'super.admin';
  const password = process.env.SUPER_ADMIN_PASSWORD || 'Barangay2026!';
  const fullName = process.env.SUPER_ADMIN_FULL_NAME || 'Super Administrator';
  const existing = await get('SELECT user_id FROM users WHERE username = ?', [username]);
  const hashed = bcrypt.hashSync(password, 10);

  if (existing) {
    await run(
      'UPDATE users SET password = ?, full_name = ?, role = ?, status = ?, updated_at = datetime("now") WHERE username = ?',
      [hashed, fullName, 'super_admin', 'Active', username]
    );
    return;
  }

  await run(
    'INSERT INTO users (username, password, full_name, role, status) VALUES (?, ?, ?, ?, ?)',
    [username, hashed, fullName, 'super_admin', 'Active']
  );
}

async function seedTestBorrower() {
  const email = process.env.TEST_BORROWER_EMAIL || 'testing.borrower@barangayhiram.test';
  const password = process.env.TEST_BORROWER_PASSWORD || 'Borrower2026!';
  const fullName = process.env.TEST_BORROWER_FULL_NAME || 'Testing Borrower';
  const firstName = process.env.TEST_BORROWER_FIRST_NAME || 'Testing';
  const lastName = process.env.TEST_BORROWER_LAST_NAME || 'Borrower';
  const contactNumber = process.env.TEST_BORROWER_CONTACT || '09170000001';
  const borrowerType = process.env.TEST_BORROWER_TYPE || 'Resident';
  const address = process.env.TEST_BORROWER_ADDRESS || 'House 1, Road 7, Barangay 628, Manila';
  const validIdReference = process.env.TEST_BORROWER_ID_REFERENCE || 'TEST-ID-0001';
  const verifiedAt = new Date().toISOString();
  const hashed = bcrypt.hashSync(password, 10);

  let user = await get('SELECT user_id FROM users WHERE username = ? OR email = ?', [email, email]);
  if (user) {
    await run(
      `UPDATE users
       SET username = ?, email = ?, password = ?, first_name = ?, last_name = ?, full_name = ?,
           role = ?, status = ?, contact_number = ?, email_verified_at = COALESCE(email_verified_at, ?),
           updated_at = datetime("now")
       WHERE user_id = ?`,
      [email, email, hashed, firstName, lastName, fullName, 'borrower', 'Approved', contactNumber, verifiedAt, user.user_id]
    );
  } else {
    const result = await run(
      `INSERT INTO users
       (username, email, password, first_name, last_name, full_name, role, status, contact_number, email_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [email, email, hashed, firstName, lastName, fullName, 'borrower', 'Approved', contactNumber, verifiedAt]
    );
    user = { user_id: result.lastID };
  }

  const borrower = await get('SELECT borrower_id FROM borrowers WHERE user_id = ?', [user.user_id]);
  const borrowerParams = [firstName, lastName, fullName, borrowerType, address, contactNumber, validIdReference, 'Approved', 'Seeded testing borrower account.'];
  if (borrower) {
    await run(
      `UPDATE borrowers
       SET first_name = ?, last_name = ?, full_name = ?, borrower_type = ?, address = ?,
           contact_number = ?, valid_id_reference = ?, verification_status = ?, verification_notes = ?
       WHERE user_id = ?`,
      borrowerParams.concat([user.user_id])
    );
  } else {
    await run(
      `INSERT INTO borrowers
       (user_id, first_name, last_name, full_name, borrower_type, address, contact_number,
        valid_id_reference, verification_status, verification_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user.user_id].concat(borrowerParams)
    );
  }

  const verification = await get('SELECT verification_id FROM borrower_verifications WHERE user_id = ?', [user.user_id]);
  const verificationParams = [borrowerType, address, validIdReference, 'Approved', 'Seeded testing borrower account.'];
  if (verification) {
    await run(
      `UPDATE borrower_verifications
       SET borrower_type = ?, address = ?, valid_id_reference = ?, status = ?, notes = ?
       WHERE user_id = ?`,
      verificationParams.concat([user.user_id])
    );
  } else {
    await run(
      `INSERT INTO borrower_verifications
       (user_id, borrower_type, address, valid_id_reference, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user.user_id].concat(verificationParams)
    );
  }
}

async function seedEquipment() {
  const items = [
    ['Monoblock Chair - White', 'Chairs', 'White monoblock chairs for barangay events and meetings.', 80, 'Good', 'Barangay Hall Storage'],
    ['Folding Table - 6ft', 'Tables', 'Six-foot folding tables for programs and public service activities.', 12, 'Good', 'Barangay Hall Storage'],
    ['Canopy Tent - 10x20', 'Tents', 'Outdoor canopy tent for barangay events.', 4, 'Good', 'Covered Court Storage'],
    ['Portable Speaker with Microphone', 'Sound Systems', 'Portable sound system with wired microphone.', 2, 'Good', 'Barangay Office'],
    ['LCD Projector', 'Projectors', 'Projector for trainings, meetings, and presentations.', 1, 'Good', 'Barangay Office'],
    ['Portable Generator', 'Generators', 'Generator for temporary event power needs.', 1, 'Good', 'Equipment Room'],
    ['Basketball Ball - Molten, Orange, Size 7', 'Sports Equipment', 'Basketball ball for barangay sports activities.', 4, 'Good', 'Equipment Room'],
    ['Volleyball Ball - Mikasa, Blue/Yellow, Size 5', 'Sports Equipment', 'Volleyball ball for barangay sports activities.', 4, 'Good', 'Equipment Room'],
    ['Chess Set - Tournament Size', 'Sports Equipment', 'Chess set for youth and community activities.', 6, 'Good', 'Barangay Office']
  ];

  for (const item of items) {
    const [name, category, description, quantity, condition, location] = item;
    const existing = await get('SELECT equipment_id FROM equipment WHERE name = ?', [name]);
    if (existing) continue;

    await run(
      `INSERT INTO equipment
       (name, category, description, quantity, available_quantity, condition, location, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, category, description, quantity, quantity, condition, location, 'Available']
    );
  }
}

async function main() {
  try {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await exec(schema);
    await patchLegacyTables();
    await seedSuperAdmin();
    await seedTestBorrower();
    await seedEquipment();
    console.log('Database setup completed.');
    console.log('Super Admin username: ' + (process.env.SUPER_ADMIN_USERNAME || 'super.admin'));
    console.log('Super Admin password: ' + (process.env.SUPER_ADMIN_PASSWORD || 'Barangay2026!'));
    console.log('Test borrower email: ' + (process.env.TEST_BORROWER_EMAIL || 'testing.borrower@barangayhiram.test'));
    console.log('Test borrower password: ' + (process.env.TEST_BORROWER_PASSWORD || 'Borrower2026!'));
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('Database setup failed:', err.message);
  db.close();
  process.exit(1);
});
