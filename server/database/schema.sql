PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT NOT NULL,
  email TEXT,
  contact_number TEXT,
  supabase_auth_user_id TEXT,
  email_verified_at TEXT,
  borrow_ready_email_sent_at TEXT,
  role TEXT NOT NULL DEFAULT 'borrower'
    CHECK (role IN ('super_admin', 'staff', 'borrower')),
  borrower_type TEXT
    CHECK (borrower_type IS NULL OR borrower_type IN ('Resident', 'Student', 'Transient')),
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Active', 'Inactive')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS borrower_verifications (
  verification_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  borrower_type TEXT NOT NULL
    CHECK (borrower_type IN ('Resident', 'Student', 'Transient')),
  address TEXT NOT NULL,
  valid_id_reference TEXT,
  document_reference TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (reviewed_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS equipment (
  equipment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Others'
    CHECK (category IN ('Chairs', 'Tables', 'Tents', 'Sound Systems', 'Projectors', 'Generators', 'Sports Equipment', 'Others')),
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  available_quantity INTEGER NOT NULL DEFAULT 1,
  condition TEXT NOT NULL DEFAULT 'Good',
  location TEXT,
  status TEXT NOT NULL DEFAULT 'Available',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS borrowing_requests (
  request_id INTEGER PRIMARY KEY AUTOINCREMENT,
  borrower_user_id INTEGER NOT NULL,
  equipment_id INTEGER NOT NULL,
  quantity_requested INTEGER NOT NULL DEFAULT 1,
  purpose TEXT NOT NULL,
  borrow_date TEXT NOT NULL,
  return_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Released', 'Returned', 'Overdue', 'Cancelled')),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  rejection_reason TEXT,
  release_quantity INTEGER,
  release_condition TEXT,
  identity_verified INTEGER NOT NULL DEFAULT 0,
  released_by INTEGER,
  returned_at TEXT,
  return_status TEXT,
  processed_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT,
  FOREIGN KEY (borrower_user_id) REFERENCES users(user_id),
  FOREIGN KEY (equipment_id) REFERENCES equipment(equipment_id),
  FOREIGN KEY (reviewed_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS releases (
  release_id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER,
  transaction_id INTEGER,
  staff_user_id INTEGER NOT NULL,
  release_date TEXT NOT NULL DEFAULT (date('now')),
  quantity_released INTEGER NOT NULL,
  condition_before_release TEXT,
  identity_verified INTEGER NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (request_id) REFERENCES borrowing_requests(request_id),
  FOREIGN KEY (staff_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS returns (
  return_id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER,
  release_id INTEGER,
  processed_by INTEGER,
  actual_return_date TEXT,
  returned_quantity INTEGER,
  return_status TEXT NOT NULL DEFAULT 'Good Condition'
    CHECK (return_status IN ('Good Condition', 'Damaged', 'Incomplete')),
  return_condition TEXT,
  condition_on_return TEXT,
  penalty_notes TEXT,
  remarks TEXT,
  received_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (request_id) REFERENCES borrowing_requests(request_id),
  FOREIGN KEY (release_id) REFERENCES releases(release_id),
  FOREIGN KEY (processed_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS activity_logs (
  log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details TEXT,
  timestamp TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);
CREATE INDEX IF NOT EXISTS idx_borrower_verifications_user ON borrower_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_category ON equipment(category);
CREATE INDEX IF NOT EXISTS idx_borrowing_requests_status ON borrowing_requests(status);
CREATE INDEX IF NOT EXISTS idx_borrowing_requests_dates ON borrowing_requests(equipment_id, borrow_date, return_date);
CREATE INDEX IF NOT EXISTS idx_releases_request ON releases(request_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at);
