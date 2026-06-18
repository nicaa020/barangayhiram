const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const dbPath = process.env.DB_PATH || './barangayhiram.db';

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to database:', err.message);
  } else {
    console.log('✅ Connected to SQLite database.');
  }
});

db.serialize(() => {
  function addColumn(table, column, definition) {
    db.run('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error(table + ' ' + column + ' column error:', err.message);
      }
    });
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    full_name TEXT,
    role TEXT DEFAULT 'staff',
    status TEXT DEFAULT 'Active',
    created_at TEXT DEFAULT (datetime('now'))
  )`, (err) => {
    if (err) console.error('Users table error:', err.message);
    else console.log('✅ Users table ready.');
  });

  db.run('ALTER TABLE users ADD COLUMN status TEXT DEFAULT "Active"', (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Users status column error:', err.message);
    }
  });
  addColumn('users', 'email', 'TEXT');
  addColumn('users', 'contact_number', 'TEXT');
  addColumn('users', 'first_name', 'TEXT');
  addColumn('users', 'last_name', 'TEXT');
  addColumn('users', 'supabase_auth_user_id', 'TEXT');
  addColumn('users', 'email_verified_at', 'TEXT');
  addColumn('users', 'borrow_ready_email_sent_at', 'TEXT');
  addColumn('users', 'updated_at', 'TEXT');

  db.run('UPDATE users SET status = "Active" WHERE status IS NULL OR status = ""');

  db.get('SELECT COUNT(*) as total FROM users', [], (err, row) => {
    if (err) {
      console.error('Default admin check error:', err.message);
      return;
    }
    if (row.total > 0) return;

    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'Barangay2026!';
    const fullName = process.env.ADMIN_FULL_NAME || 'Barangay Admin';
    const hashed = bcrypt.hashSync(password, 10);

    db.run(
      'INSERT INTO users (username, password, full_name, role, status) VALUES (?, ?, ?, ?, ?)',
      [username, hashed, fullName, 'admin', 'Active'],
      (insertErr) => {
        if (insertErr) {
          console.error('Default admin seed error:', insertErr.message);
        } else {
          console.log('Default admin account ready.');
        }
      }
    );
  });

  db.run(`CREATE TABLE IF NOT EXISTS equipment (
    equipment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    quantity INTEGER DEFAULT 1,
    available_quantity INTEGER DEFAULT 1,
    status TEXT DEFAULT 'Available',
    created_at TEXT DEFAULT (datetime('now'))
  )`, (err) => {
    if (err) console.error('Equipment table error:', err.message);
    else console.log('✅ Equipment table ready.');
  });
  addColumn('equipment', 'condition', 'TEXT DEFAULT "Good"');
  addColumn('equipment', 'location', 'TEXT');
  addColumn('equipment', 'is_high_value', 'INTEGER DEFAULT 0');

  db.run(`CREATE TABLE IF NOT EXISTS borrowers (
    borrower_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    full_name TEXT NOT NULL,
    borrower_type TEXT DEFAULT 'Resident',
    address TEXT,
    contact_number TEXT,
    valid_id_reference TEXT,
    verification_document TEXT,
    verification_status TEXT DEFAULT 'Approved',
    verification_notes TEXT,
    is_flagged INTEGER DEFAULT 0,
    flag_reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`, (err) => {
    if (err) console.error('Borrowers table error:', err.message);
    else console.log('✅ Borrowers table ready.');
  });
  addColumn('borrowers', 'user_id', 'INTEGER');
  addColumn('borrowers', 'first_name', 'TEXT');
  addColumn('borrowers', 'last_name', 'TEXT');
  addColumn('borrowers', 'borrower_type', 'TEXT DEFAULT "Resident"');
  addColumn('borrowers', 'valid_id_reference', 'TEXT');
  addColumn('borrowers', 'verification_document', 'TEXT');
  addColumn('borrowers', 'verification_status', 'TEXT DEFAULT "Approved"');
  addColumn('borrowers', 'verification_notes', 'TEXT');
  addColumn('borrowers', 'is_flagged', 'INTEGER DEFAULT 0');
  addColumn('borrowers', 'flag_reason', 'TEXT');

  db.run(`CREATE TABLE IF NOT EXISTS borrower_verifications (
    verification_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    borrower_type TEXT NOT NULL DEFAULT 'Resident',
    address TEXT NOT NULL,
    valid_id_reference TEXT,
    document_reference TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'Pending',
    reviewed_by INTEGER,
    reviewed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (reviewed_by) REFERENCES users(user_id)
  )`, (err) => {
    if (err) console.error('Borrower verifications table error:', err.message);
    else console.log('Borrower verifications table ready.');
  });

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
    borrower_id INTEGER NOT NULL,
    equipment_id INTEGER NOT NULL,
    quantity_borrowed INTEGER DEFAULT 1,
    purpose TEXT,
    event_location TEXT,
    date_borrowed TEXT,
    due_date TEXT,
    status TEXT DEFAULT 'Pending',
    release_date TEXT,
    release_quantity INTEGER,
    release_condition TEXT,
    identity_verified INTEGER DEFAULT 0,
    released_by INTEGER,
    returned_at TEXT,
    return_status TEXT,
    processed_by INTEGER,
    rejection_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (borrower_id) REFERENCES borrowers(borrower_id),
    FOREIGN KEY (equipment_id) REFERENCES equipment(equipment_id)
  )`, (err) => {
    if (err) console.error('Transactions table error:', err.message);
    else console.log('✅ Transactions table ready.');
  });

  db.run(`CREATE TABLE IF NOT EXISTS returns (
    return_id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL,
    actual_return_date TEXT,
    condition_on_return TEXT DEFAULT 'Good',
    remarks TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id)
  )`, (err) => {
    if (err) console.error('Returns table error:', err.message);
    else console.log('✅ Returns table ready.');
  });

  addColumn('returns', 'returned_quantity', 'INTEGER');
  addColumn('returns', 'return_condition', 'TEXT');
  addColumn('returns', 'penalty_notes', 'TEXT');
  addColumn('returns', 'received_by', 'INTEGER');

  db.run(`CREATE TABLE IF NOT EXISTS releases (
    release_id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL,
    staff_user_id INTEGER NOT NULL,
    release_date TEXT NOT NULL DEFAULT (date('now')),
    quantity_released INTEGER NOT NULL,
    condition_before_release TEXT,
    identity_verified INTEGER NOT NULL DEFAULT 0,
    remarks TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id),
    FOREIGN KEY (staff_user_id) REFERENCES users(user_id)
  )`, (err) => {
    if (err) console.error('Releases table error:', err.message);
    else console.log('Releases table ready.');
  });
  addColumn('releases', 'transaction_id', 'INTEGER');
  addColumn('releases', 'staff_user_id', 'INTEGER');
  addColumn('releases', 'release_date', 'TEXT');
  addColumn('releases', 'quantity_released', 'INTEGER');
  addColumn('releases', 'condition_before_release', 'TEXT');
  addColumn('releases', 'identity_verified', 'INTEGER DEFAULT 0');
  addColumn('releases', 'remarks', 'TEXT');

  db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    borrower_id INTEGER,
    equipment_id INTEGER,
    transaction_id INTEGER,
    return_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    timestamp TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (borrower_id) REFERENCES borrowers(borrower_id),
    FOREIGN KEY (equipment_id) REFERENCES equipment(equipment_id),
    FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id),
    FOREIGN KEY (return_id) REFERENCES returns(return_id)
  )`, (err) => {
    if (err) console.error('Activity logs table error:', err.message);
    else console.log('✅ Activity logs table ready.');
  });
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  )`, (err) => {
    if (err) console.error('Notifications table error:', err.message);
    else console.log('Notifications table ready.');
  });

  addColumn('transactions', 'release_date', 'TEXT');
  addColumn('transactions', 'event_location', 'TEXT');
  addColumn('transactions', 'release_quantity', 'INTEGER');
  addColumn('transactions', 'release_condition', 'TEXT');
  addColumn('transactions', 'identity_verified', 'INTEGER DEFAULT 0');
  addColumn('transactions', 'released_by', 'INTEGER');
  addColumn('transactions', 'returned_at', 'TEXT');
  addColumn('transactions', 'return_status', 'TEXT');
  addColumn('transactions', 'processed_by', 'INTEGER');
  addColumn('transactions', 'rejection_reason', 'TEXT');

  [
    ['borrower_id', 'INTEGER'],
    ['equipment_id', 'INTEGER'],
    ['transaction_id', 'INTEGER'],
    ['return_id', 'INTEGER']
  ].forEach(([column, type]) => {
    db.run(`ALTER TABLE activity_logs ADD COLUMN ${column} ${type}`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Activity logs ' + column + ' column error:', err.message);
      }
    });
  });

});

module.exports = db;
