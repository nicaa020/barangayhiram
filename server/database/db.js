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

  db.run(`CREATE TABLE IF NOT EXISTS borrowers (
    borrower_id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    address TEXT,
    contact_number TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`, (err) => {
    if (err) console.error('Borrowers table error:', err.message);
    else console.log('✅ Borrowers table ready.');
  });

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
    borrower_id INTEGER NOT NULL,
    equipment_id INTEGER NOT NULL,
    quantity_borrowed INTEGER DEFAULT 1,
    purpose TEXT,
    date_borrowed TEXT,
    due_date TEXT,
    status TEXT DEFAULT 'Pending',
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
