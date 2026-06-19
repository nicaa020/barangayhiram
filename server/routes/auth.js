'use strict';
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const logActivity = require('../utils/activity');
const supabaseProfiles = require('../utils/supabaseProfiles');
const email = require('../utils/email');
const appUrl = require('../utils/appUrl');

const USERNAME_REQUIREMENTS = 'Username must be 4-60 characters, or use a valid email address.';
const PASSWORD_REQUIREMENTS = 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.';
const CONTACT_NUMBER_REQUIREMENTS = 'Contact number must contain exactly 11 numbers or start with +63 followed by 10 numbers.';
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{4,30}$/;
const CONTACT_NUMBER_PATTERN = /^([0-9]{11}|\+63[0-9]{10})$/;
const STAFF_ROLES = ['super_admin', 'admin', 'staff'];
const ALL_ROLES = ['super_admin', 'admin', 'staff', 'borrower'];
const USER_STATUSES = ['Pending', 'Approved', 'Rejected', 'Active', 'Inactive'];
const BORROWER_TYPES = ['Resident', 'Student', 'Transient'];
const UPLOAD_DIR = path.join(__dirname, '../../public/uploads/verifications');
const ALLOWED_DOCUMENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf'
};

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isSuperAdmin(req) {
  return req.user && req.user.role === 'super_admin';
}

function validateUsername(username) {
  if (USERNAME_PATTERN.test(username)) return null;
  if (!username || /\s/.test(username)) return USERNAME_REQUIREMENTS;
  const parts = username.split('@');
  if (parts.length !== 2) return USERNAME_REQUIREMENTS;
  const local = parts[0];
  const domain = parts[1];
  if (!local || !domain) return USERNAME_REQUIREMENTS;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return USERNAME_REQUIREMENTS;
  if (!domain.includes('.')) return USERNAME_REQUIREMENTS;
  const labels = domain.split('.');
  if (labels.some(function(label) { return !label || label.startsWith('-') || label.endsWith('-'); })) {
    return USERNAME_REQUIREMENTS;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username) ? null : USERNAME_REQUIREMENTS;
}

function validatePassword(password) {
  if (
    typeof password !== 'string' ||
    password.length < 8 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return PASSWORD_REQUIREMENTS;
  }
  return null;
}

function validateContactNumber(contactNumber) {
  return CONTACT_NUMBER_PATTERN.test(contactNumber) ? null : CONTACT_NUMBER_REQUIREMENTS;
}

function findUserByUsernameOrEmail(username) {
  return new Promise(function(resolve, reject) {
    db.get(
      'SELECT user_id FROM users WHERE username = ? OR email = ?',
      [username, username],
      function(err, row) {
        if (err) return reject(err);
        return resolve(row);
      }
    );
  });
}

function updateUserPasswordHash(userId, password) {
  return new Promise(function(resolve, reject) {
    db.run(
      'UPDATE users SET password = ?, updated_at = datetime("now") WHERE user_id = ?',
      [bcrypt.hashSync(password, 10), userId],
      function(err) {
        if (err) return reject(err);
        return resolve(this.changes);
      }
    );
  });
}

function saveVerificationDocument(dataUrl, originalName) {
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match || !ALLOWED_DOCUMENT_TYPES[match[1]]) {
    throw new Error('Verification document must be a JPG, PNG, WebP, or PDF file.');
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error('Verification document must not exceed 5MB.');
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const safeBase = String(originalName || 'verification')
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'verification';
  const fileName = Date.now() + '-' + Math.round(Math.random() * 1e9) + '-' + safeBase + '.' + ALLOWED_DOCUMENT_TYPES[match[1]];
  const filePath = path.join(UPLOAD_DIR, fileName);
  fs.writeFileSync(filePath, buffer);
  return '/uploads/verifications/' + fileName;
}

function publicUser(user) {
  return {
    user_id: user.user_id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    status: user.status,
    account_status: user.status,
    email_verified_at: user.email_verified_at || null,
    verification_status: user.verification_status || user.status
  };
}

function emailRedirectTo(req) {
  return appUrl.loginUrl(req.protocol + '://' + req.get('host'), 'email_verified=1');
}

async function ensureBorrowerEmailConfirmed(user) {
  if (user.role !== 'borrower') {
    return { confirmed: true, email_verified_at: user.email_verified_at || null };
  }
  if (!supabaseProfiles.isConfigured()) {
    return {
      confirmed: false,
      message: 'Email verification is not configured. Please contact the administrator.'
    };
  }
  if (!user.supabase_auth_user_id) {
    if (user.email_verified_at) {
      return { confirmed: true, email_verified_at: user.email_verified_at };
    }
    return {
      confirmed: false,
      message: 'Please verify your email before logging in.'
    };
  }

  const authUser = await supabaseProfiles.getAuthUser(user.supabase_auth_user_id);
  const confirmedAt = authUser.email_confirmed_at || authUser.confirmed_at || null;
  if (!confirmedAt) {
    return {
      confirmed: false,
      message: 'Please verify your email before logging in.'
    };
  }

  if (!user.email_verified_at) {
    db.run('UPDATE users SET email_verified_at = ?, updated_at = datetime("now") WHERE user_id = ?', [confirmedAt, user.user_id]);
  }
  return { confirmed: true, email_verified_at: confirmedAt };
}

async function syncBorrowerEmailConfirmation(user) {
  if (!user || user.role !== 'borrower' || !user.supabase_auth_user_id) {
    return { confirmed: false, message: 'Email verification is not confirmed yet.' };
  }
  if (!supabaseProfiles.isConfigured()) {
    return { confirmed: false, message: 'Email verification is not configured.' };
  }

  const authUser = await supabaseProfiles.getAuthUser(user.supabase_auth_user_id);
  const confirmedAt = authUser.email_confirmed_at || authUser.confirmed_at || null;
  if (!confirmedAt) {
    return { confirmed: false, message: 'Email verification is not confirmed yet.' };
  }

  if (!user.email_verified_at) {
    await new Promise(function(resolve, reject) {
      db.run(
        'UPDATE users SET email_verified_at = ?, updated_at = datetime("now") WHERE user_id = ?',
        [confirmedAt, user.user_id],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  return {
    confirmed: true,
    email_verified_at: confirmedAt,
    account_status: user.status,
    redirect_to: user.status === 'Approved' || user.status === 'Active'
      ? '/borrower/dashboard'
      : '/verification-status'
  };
}

function createNotification(userId, title, message, type, callback) {
  db.run(
    `INSERT INTO notifications (user_id, title, message, type, is_read)
     VALUES (?, ?, ?, ?, 0)`,
    [userId, title, message, type],
    callback || function() {}
  );
}

async function sendBorrowerReadyEmailIfEligible(userId) {
  const user = await new Promise(function(resolve, reject) {
    db.get(
      `SELECT u.user_id, u.username, u.email, u.full_name, u.status, u.email_verified_at,
              u.supabase_auth_user_id, u.borrow_ready_email_sent_at,
              b.verification_status
       FROM users u
       LEFT JOIN borrowers b ON u.user_id = b.user_id
       WHERE u.user_id = ?`,
      [userId],
      function(err, row) {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });

  if (!user) return { sent: false, skipped: true, reason: 'missing_user' };
  if (user.borrow_ready_email_sent_at) return { sent: false, skipped: true, reason: 'already_sent' };
  if (!user.email_verified_at) {
    try {
      let emailStatus = await ensureBorrowerEmailConfirmed(Object.assign({}, user, { role: 'borrower' }));
      if (emailStatus.confirmed) {
        user.email_verified_at = emailStatus.email_verified_at;
      }
      if (!emailStatus.confirmed) {
        const authUser = await supabaseProfiles.findAuthUserByEmail(user.email || user.username);
        const confirmedAt = authUser && (authUser.email_confirmed_at || authUser.confirmed_at || null);
        if (confirmedAt) {
          await new Promise(function(resolve, reject) {
            db.run(
              'UPDATE users SET supabase_auth_user_id = ?, email_verified_at = ?, updated_at = datetime("now") WHERE user_id = ?',
              [authUser.id, confirmedAt, user.user_id],
              function(err) {
                if (err) reject(err);
                else resolve();
              }
            );
          });
          user.supabase_auth_user_id = authUser.id;
          user.email_verified_at = confirmedAt;
        }
      }
    } catch (err) {
      console.warn('Unable to sync email verification before approval email:', err.message);
    }
  }
  if (!user.email_verified_at) {
    console.warn('Sending approval email before local email verification sync for user #' + user.user_id);
  }
  if (!['Approved', 'Active'].includes(user.status) || user.verification_status !== 'Approved') {
    return { sent: false, skipped: true, reason: 'account_not_approved' };
  }

  const result = await email.sendBorrowerReadyEmail(user);
  if (result.sent) {
    await new Promise(function(resolve, reject) {
      db.run(
        'UPDATE users SET borrow_ready_email_sent_at = datetime("now"), updated_at = datetime("now") WHERE user_id = ?',
        [userId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }
  return result;
}

router.post('/register', auth, admin, function(req, res) {
  const username = cleanText(req.body.username);
  const password = req.body.password;
  const full_name = cleanText(req.body.full_name);
  const role = cleanText(req.body.role || 'staff');

  if (!username || !password || !full_name) {
    return res.status(400).json({ message: 'Please fill in all fields.' });
  }
  const usernameError = validateUsername(username);
  if (usernameError) return res.status(400).json({ message: usernameError });
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ message: passwordError });
  if (!STAFF_ROLES.includes(role)) {
    return res.status(400).json({ message: 'Invalid role selected.' });
  }
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ message: 'Only the super admin can create staff accounts.' });
  }

  const hashed = bcrypt.hashSync(password, 10);
  db.run(
    'INSERT INTO users (username, password, full_name, role, status) VALUES (?, ?, ?, ?, ?)',
    [username, hashed, full_name, role, 'Active'],
    function(err) {
      if (err) return res.status(400).json({ message: 'Username already exists.' });
      logActivity(req.user.user_id, 'Created staff account', full_name + ' (' + username + ') as ' + role);
      return res.status(200).json({ message: 'Account created successfully!' });
    }
  );
});

router.post('/register-borrower', async function(req, res) {
  const username = cleanText(req.body.username);
  const password = req.body.password;
  const first_name = cleanText(req.body.first_name);
  const last_name = cleanText(req.body.last_name);
  const full_name = cleanText(req.body.full_name || (first_name + ' ' + last_name).trim());
  const borrower_type = cleanText(req.body.borrower_type || 'Resident');
  const address = cleanText(req.body.address);
  const contact_number = cleanText(req.body.contact_number);
  const valid_id_reference = cleanText(req.body.valid_id_reference);
  let verification_document = cleanText(req.body.verification_document);
  const verification_document_data = req.body.verification_document_data;
  const verification_document_name = cleanText(req.body.verification_document_name);
  const verification_capture_method = cleanText(req.body.verification_capture_method);

  if (!username || !password || !first_name || !last_name || !full_name || !contact_number || !valid_id_reference) {
    return res.status(400).json({ message: 'Please complete all required registration and verification fields.' });
  }
  const usernameError = validateUsername(username);
  if (usernameError) return res.status(400).json({ message: usernameError });
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ message: passwordError });
  const contactNumberError = validateContactNumber(contact_number);
  if (contactNumberError) return res.status(400).json({ message: contactNumberError });
  if (!BORROWER_TYPES.includes(borrower_type)) {
    return res.status(400).json({ message: 'Invalid borrower type selected.' });
  }
  if ((borrower_type === 'Resident' || borrower_type === 'Transient') && !address) {
    return res.status(400).json({ message: borrower_type + ' borrowers must provide an address.' });
  }
  if (verification_capture_method !== 'live_camera') {
    return res.status(400).json({ message: 'Verification document must be captured using the live camera.' });
  }
  if (!verification_document_data || !String(verification_document_data).startsWith('data:image/')) {
    return res.status(400).json({ message: 'Please capture your required ID or verification document using the live camera.' });
  }
  if (!supabaseProfiles.isConfigured()) {
    return res.status(503).json({ message: 'Supabase email verification is not configured. Please contact the administrator.' });
  }

  try {
    const existingUser = await findUserByUsernameOrEmail(username);
    if (existingUser) {
      return res.status(400).json({
        message: 'This email is already registered in BarangayHiram. Please log in, use another email, or ask staff to delete the local account record.'
      });
    }
  } catch (err) {
    return res.status(500).json({ message: 'Unable to check existing account records.' });
  }

  try {
    if (verification_document_data) {
      verification_document = saveVerificationDocument(verification_document_data, verification_document_name);
    }
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  let supabaseAccount = { skipped: true };
  try {
    supabaseAccount = await supabaseProfiles.createBorrowerProfileAccount({
      email: username,
      password: password,
      full_name: full_name,
      borrower_type: borrower_type,
      contact_number: contact_number,
      address: address,
      verification_document_url: verification_document,
      email_redirect_to: emailRedirectTo(req)
    });
  } catch (err) {
    return res.status(400).json({ message: 'Unable to create Supabase borrower profile: ' + err.message });
  }

  const hashed = bcrypt.hashSync(password, 10);
  db.run(
    'INSERT INTO users (username, email, password, first_name, last_name, full_name, role, status, contact_number, supabase_auth_user_id, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [username, username, hashed, first_name, last_name, full_name, 'borrower', 'Pending', contact_number, supabaseAccount.auth_user_id, supabaseAccount.email_confirmed_at || null],
    function(err) {
      if (err) {
        if (!supabaseAccount.skipped) supabaseProfiles.deleteAuthUser(supabaseAccount.auth_user_id);
        return res.status(400).json({ message: 'Username already exists.' });
      }
      const userId = this.lastID;
      db.run(
        `INSERT INTO borrowers
         (user_id, first_name, last_name, full_name, borrower_type, address, contact_number, valid_id_reference, verification_document, verification_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, first_name, last_name, full_name, borrower_type, address, contact_number, valid_id_reference, verification_document, 'Pending'],
        function(err) {
          if (err) {
            if (!supabaseAccount.skipped) supabaseProfiles.deleteAuthUser(supabaseAccount.auth_user_id);
            return res.status(500).json({ message: 'Unable to create borrower profile.' });
          }
          const borrowerId = this.lastID;
          db.run(
            `INSERT INTO borrower_verifications
             (user_id, borrower_type, address, valid_id_reference, document_reference, status)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, borrower_type, address, valid_id_reference, verification_document, 'Pending'],
            function(err) {
              if (err) {
                if (!supabaseAccount.skipped) supabaseProfiles.deleteAuthUser(supabaseAccount.auth_user_id);
                return res.status(500).json({ message: 'Unable to create borrower verification record.' });
              }
              logActivity(userId, 'Registered borrower account', full_name + ' submitted verification as ' + borrower_type, {
                borrower_id: borrowerId
              });
              return res.status(200).json({
                message: 'Registration submitted. Please check your email and verify your account before logging in.',
                user_id: userId,
                borrower_id: borrowerId,
                verification_id: this.lastID,
                supabase_auth_user_id: supabaseAccount.auth_user_id,
                account_status: 'Pending'
              });
            }
          );
        }
      );
    }
  );
});

router.post('/login', function(req, res) {
  const username = cleanText(req.body.username);
  const password = req.body.password;

  if (!username || !password) {
    return res.status(400).json({ message: 'Please enter username and password.' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], async function(err, user) {
    if (err) return res.status(500).json({ message: 'Database error.' });
    if (!user) return res.status(400).json({ message: 'User not found.' });
    if (user.status === 'Inactive' || user.status === 'Rejected') {
      return res.status(403).json({ message: 'This account is inactive or rejected. Please contact the administrator.' });
    }
    let validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword && user.role === 'borrower' && user.supabase_auth_user_id && supabaseProfiles.isConfigured()) {
      try {
        await supabaseProfiles.signInWithPassword(user.email || user.username, password);
        await updateUserPasswordHash(user.user_id, password);
        validPassword = true;
      } catch (err) {
        validPassword = false;
      }
    }
    if (!validPassword) return res.status(401).json({ message: 'Incorrect password.' });

    try {
      const emailStatus = await ensureBorrowerEmailConfirmed(user);
      if (!emailStatus.confirmed) {
        return res.status(403).json({ message: emailStatus.message || 'Please verify your email before logging in.' });
      }
      if (emailStatus.email_verified_at) {
        user.email_verified_at = emailStatus.email_verified_at;
      }
    } catch (err) {
      return res.status(403).json({ message: 'Please verify your email before logging in.' });
    }

    const secret = process.env.JWT_SECRET || 'barangayhiram_secret_key_2024';
    const token = jwt.sign(publicUser(user), secret, { expiresIn: '8h' });

    logActivity(user.user_id, 'Logged in', user.full_name + ' signed in');
    return res.status(200).json({
      message: 'Login successful!',
      token: token,
      user: publicUser(user),
      redirect_to: user.role === 'borrower' && user.status !== 'Approved' && user.status !== 'Active'
        ? '/verification-status'
        : null
    });
  });
});

router.post('/email-verification-status', async function(req, res) {
  const username = cleanText(req.body.username || req.body.email);
  if (!username) {
    return res.status(400).json({ message: 'Email is required.' });
  }

  db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username], async function(err, user) {
    if (err) return res.status(500).json({ message: 'Database error.' });
    if (!user || user.role !== 'borrower') {
      return res.status(200).json({ verified: false, message: 'Email verification is not confirmed yet.' });
    }

    try {
      const status = await syncBorrowerEmailConfirmation(user);
      if (status.confirmed && (status.account_status === 'Approved' || status.account_status === 'Active')) {
        sendBorrowerReadyEmailIfEligible(user.user_id).catch(function(err) {
          console.warn('Unable to send borrower ready email:', err.message);
        });
      }
      return res.status(200).json({
        verified: status.confirmed,
        message: status.confirmed
          ? 'Email verified successfully. Barangay staff approval is still required before borrowing.'
          : status.message,
        account_status: status.account_status || user.status,
        redirect_to: status.redirect_to || null
      });
    } catch (err) {
      return res.status(500).json({ message: 'Unable to check email verification right now.' });
    }
  });
});

router.get('/supabase-public-config', function(req, res) {
  return res.status(200).json({
    url: process.env.SUPABASE_URL || '',
    anon_key: process.env.SUPABASE_ANON_KEY || ''
  });
});

router.post('/sync-reset-password', async function(req, res) {
  const accessToken = cleanText(req.body.access_token);
  const password = req.body.password;
  const passwordError = validatePassword(password);

  if (passwordError) return res.status(400).json({ message: passwordError });
  if (!accessToken) return res.status(401).json({ message: 'Password reset session is missing. Please open the latest reset link from your email.' });
  if (!supabaseProfiles.isConfigured()) return res.status(500).json({ message: 'Supabase Auth is not configured.' });

  try {
    const authUser = await supabaseProfiles.getUserFromAccessToken(accessToken);
    const authUserId = authUser && authUser.id;
    const emailAddress = authUser && authUser.email;

    if (!authUserId) {
      return res.status(401).json({ message: 'Password reset session is invalid or expired.' });
    }

    db.get(
      'SELECT * FROM users WHERE supabase_auth_user_id = ? OR email = ? OR username = ?',
      [authUserId, emailAddress, emailAddress],
      async function(err, user) {
        if (err) return res.status(500).json({ message: 'Database error.' });
        if (!user) return res.status(404).json({ message: 'BarangayHiram account was not found.' });

        try {
          await updateUserPasswordHash(user.user_id, password);
          logActivity(user.user_id, 'Reset password', user.full_name + ' reset password through Supabase Auth');
          return res.status(200).json({ message: 'Password synchronized successfully.' });
        } catch (updateErr) {
          return res.status(500).json({ message: 'Unable to update local password.' });
        }
      }
    );
  } catch (err) {
    return res.status(401).json({ message: 'Password reset session is invalid or expired.' });
  }
});

router.get('/me', auth, function(req, res) {
  db.get(
    `SELECT u.user_id, u.username, u.email, u.first_name, u.last_name, u.full_name,
            u.supabase_auth_user_id, u.email_verified_at,
            u.role, u.status, COALESCE(b.contact_number, u.contact_number) as contact_number,
            b.borrower_id,
            COALESCE(b.borrower_type, bv.borrower_type) as borrower_type,
            COALESCE(b.address, bv.address) as address,
            COALESCE(b.valid_id_reference, bv.valid_id_reference) as valid_id_reference,
            COALESCE(b.verification_document, bv.document_reference) as verification_document,
            COALESCE(b.verification_status, bv.status, u.status) as verification_status,
            COALESCE(b.verification_notes, bv.notes) as verification_notes,
            COALESCE(b.is_flagged, 0) as is_flagged,
            b.flag_reason
     FROM users u
     LEFT JOIN borrowers b ON u.user_id = b.user_id
     LEFT JOIN (
       SELECT bv1.*
       FROM borrower_verifications bv1
       JOIN (
         SELECT user_id, MAX(verification_id) as verification_id
         FROM borrower_verifications
         GROUP BY user_id
       ) latest ON bv1.verification_id = latest.verification_id
     ) bv ON u.user_id = bv.user_id
     WHERE u.user_id = ?`,
    [req.user.user_id],
    async function(err, row) {
      if (err) return res.status(500).json({ message: 'Database error.' });
      if (!row) return res.status(404).json({ message: 'Account not found.' });
      try {
        const emailStatus = await ensureBorrowerEmailConfirmed(row);
        if (!emailStatus.confirmed) {
          return res.status(403).json({ message: emailStatus.message || 'Please verify your email before logging in.' });
        }
        if (emailStatus.email_verified_at) {
          row.email_verified_at = emailStatus.email_verified_at;
        }
      } catch (err) {
        return res.status(403).json({ message: 'Please verify your email before logging in.' });
      }
      return res.status(200).json(row);
    }
  );
});

router.put('/profile', auth, function(req, res) {
  const username = cleanText(req.body.username);
  const first_name = cleanText(req.body.first_name);
  const last_name = cleanText(req.body.last_name);
  const full_name = cleanText(req.body.full_name || (first_name + ' ' + last_name).trim());
  const contact_number = cleanText(req.body.contact_number);
  const borrower_type = cleanText(req.body.borrower_type || 'Resident');
  const address = cleanText(req.body.address);

  if (!username || !full_name || !contact_number) {
    return res.status(400).json({ message: 'Please complete your profile details.' });
  }
  const usernameError = validateUsername(username);
  if (usernameError) return res.status(400).json({ message: usernameError });
  const contactNumberError = validateContactNumber(contact_number);
  if (contactNumberError) return res.status(400).json({ message: contactNumberError });
  if (req.user.role === 'borrower' && !BORROWER_TYPES.includes(borrower_type)) {
    return res.status(400).json({ message: 'Invalid borrower type selected.' });
  }

  db.run(
    'UPDATE users SET username = ?, first_name = ?, last_name = ?, full_name = ?, contact_number = ?, updated_at = datetime("now") WHERE user_id = ?',
    [username, first_name || null, last_name || null, full_name, contact_number, req.user.user_id],
    function(err) {
      if (err) return res.status(400).json({ message: 'Username or email already exists.' });
      if (this.changes === 0) return res.status(404).json({ message: 'Account not found.' });

      if (req.user.role !== 'borrower') {
        logActivity(req.user.user_id, 'Updated profile', full_name + ' updated account profile');
        return res.status(200).json({ message: 'Profile updated successfully.' });
      }

      db.run(
        `UPDATE borrowers
         SET first_name = ?, last_name = ?, full_name = ?, borrower_type = ?, address = ?, contact_number = ?
         WHERE user_id = ?`,
        [first_name || null, last_name || null, full_name, borrower_type, address, contact_number, req.user.user_id],
        function(err) {
          if (err) return res.status(500).json({ message: 'Unable to update borrower profile.' });
          logActivity(req.user.user_id, 'Updated profile', full_name + ' updated borrower profile');
          return res.status(200).json({ message: 'Profile updated successfully.' });
        }
      );
    }
  );
});

router.get('/users', auth, admin, function(req, res) {
  db.all(
    `SELECT u.user_id, u.username, u.email, u.first_name, u.last_name, u.full_name,
            u.role, u.status, COALESCE(b.contact_number, u.contact_number) as contact_number, u.created_at,
            b.borrower_id, b.borrower_type, b.address, b.valid_id_reference,
            b.verification_document, b.verification_status, b.verification_notes,
            b.is_flagged, b.flag_reason
     FROM users u
     LEFT JOIN borrowers b ON u.user_id = b.user_id
     ORDER BY u.created_at DESC`,
    [],
    function(err, rows) {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(rows);
    }
  );
});

router.put('/users/:id', auth, admin, function(req, res) {
  const full_name = cleanText(req.body.full_name);
  const username = cleanText(req.body.username);
  const role = cleanText(req.body.role);
  const status = cleanText(req.body.status);
  const password = req.body.password;

  if (!username || !full_name || !role || !status) {
    return res.status(400).json({ message: 'Please fill in all required fields.' });
  }
  const usernameError = validateUsername(username);
  if (usernameError) return res.status(400).json({ message: usernameError });
  if (password) {
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ message: passwordError });
  }
  if (!ALL_ROLES.includes(role)) return res.status(400).json({ message: 'Invalid role selected.' });
  if (!USER_STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid account status selected.' });
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ message: 'Only the super admin can update staff accounts and account permissions.' });
  }

  function finishUpdate(sql, params) {
    db.run(sql, params, function(err) {
      if (err) return res.status(400).json({ message: 'Username already exists.' });
      if (this.changes === 0) return res.status(404).json({ message: 'Account not found.' });
      logActivity(req.user.user_id, 'Updated account', full_name + ' (' + username + ')');
      return res.status(200).json({ message: 'Account updated successfully!' });
    });
  }

  if (password) {
    const hashed = bcrypt.hashSync(password, 10);
    finishUpdate(
      'UPDATE users SET username = ?, password = ?, full_name = ?, role = ?, status = ?, updated_at = datetime("now") WHERE user_id = ?',
      [username, hashed, full_name, role, status, req.params.id]
    );
  } else {
    finishUpdate(
      'UPDATE users SET username = ?, full_name = ?, role = ?, status = ?, updated_at = datetime("now") WHERE user_id = ?',
      [username, full_name, role, status, req.params.id]
    );
  }
});

router.put('/users/:id/verification', auth, admin, function(req, res) {
  const status = cleanText(req.body.status);
  const notes = cleanText(req.body.notes);
  if (status !== 'Approved' && status !== 'Rejected') {
    return res.status(400).json({ message: 'Verification status must be Approved or Rejected.' });
  }
  if (status === 'Rejected' && !notes) {
    return res.status(400).json({ message: 'Rejection reason is required.' });
  }

  db.get('SELECT * FROM users WHERE user_id = ?', [req.params.id], function(err, user) {
    if (err) return res.status(500).json({ message: 'Database error.' });
    if (!user) return res.status(404).json({ message: 'Account not found.' });
    if (user.role !== 'borrower') return res.status(400).json({ message: 'Only borrower accounts need verification.' });

    db.run('UPDATE users SET status = ?, updated_at = datetime("now") WHERE user_id = ?', [status, req.params.id], function(err) {
      if (err) return res.status(500).json({ message: 'Unable to update account status.' });
      db.run(
        'UPDATE borrowers SET verification_status = ?, verification_notes = ? WHERE user_id = ?',
        [status, notes, req.params.id],
        function(err) {
          if (err) return res.status(500).json({ message: 'Unable to update borrower verification.' });
          db.run(
            `UPDATE borrower_verifications
             SET status = ?, notes = ?, reviewed_by = ?, reviewed_at = datetime("now")
             WHERE user_id = ?`,
            [status, notes, req.user.user_id, req.params.id],
            function(err) {
              if (err) return res.status(500).json({ message: 'Unable to update borrower verification record.' });
              logActivity(req.user.user_id, status + ' borrower account', user.full_name + (notes ? ': ' + notes : ''));
              const title = status === 'Approved' ? 'Account approved' : 'Account rejected';
              const message = status === 'Approved'
                ? 'Your BarangayHiram account has been approved. You can now borrow equipment after logging in.'
                : 'Your BarangayHiram account was rejected. ' + (notes ? 'Reason: ' + notes : 'Please contact barangay staff for details.');
              createNotification(req.params.id, title, message, status === 'Approved' ? 'account_approved' : 'account_rejected', function(notificationErr) {
                if (notificationErr) {
                  return res.status(500).json({ message: 'Verification updated, but notification could not be created.' });
                }
                if (status !== 'Approved') {
                  return res.status(200).json({ message: 'Borrower verification updated.' });
                }
                sendBorrowerReadyEmailIfEligible(req.params.id)
                  .then(function(emailResult) {
                    return res.status(200).json({
                      message: emailResult.sent
                        ? 'Borrower verification updated and approval email sent.'
                        : 'Borrower verification updated.',
                      email_sent: Boolean(emailResult.sent),
                      email_skipped_reason: emailResult.reason || null
                    });
                  })
                  .catch(function(emailErr) {
                    console.error('Borrower approval email error:', emailErr.message);
                    return res.status(200).json({
                      message: 'Borrower verification updated, but approval email could not be sent: ' + emailErr.message,
                      email_sent: false,
                      email_error: emailErr.message
                    });
                  });
              });
            }
          );
        }
      );
    });
  });
});

router.post('/users/:id/resend-approval-email', auth, admin, function(req, res) {
  db.run('UPDATE users SET borrow_ready_email_sent_at = NULL WHERE user_id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ message: 'Unable to prepare approval email resend.' });
    sendBorrowerReadyEmailIfEligible(req.params.id)
      .then(function(emailResult) {
        if (emailResult.sent) {
          return res.status(200).json({ message: 'Approval email sent.', email_sent: true });
        }
        return res.status(400).json({
          message: 'Approval email was not sent.',
          email_sent: false,
          email_skipped_reason: emailResult.reason || 'unknown'
        });
      })
      .catch(function(emailErr) {
        console.error('Approval email resend error:', emailErr.message);
        return res.status(500).json({
          message: 'Approval email could not be sent: ' + emailErr.message,
          email_sent: false,
          email_error: emailErr.message
        });
      });
  });
});

router.put('/change-password', auth, function(req, res) {
  const currentPassword = req.body.current_password;
  const newPassword = req.body.new_password;
  const passwordError = validatePassword(newPassword);
  if (passwordError) return res.status(400).json({ message: passwordError });

  db.get('SELECT * FROM users WHERE user_id = ?', [req.user.user_id], function(err, user) {
    if (err) return res.status(500).json({ message: 'Database error.' });
    if (!user) return res.status(404).json({ message: 'Account not found.' });
    if (!bcrypt.compareSync(currentPassword || '', user.password)) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }
    db.run(
      'UPDATE users SET password = ?, updated_at = datetime("now") WHERE user_id = ?',
      [bcrypt.hashSync(newPassword, 10), req.user.user_id],
      function(err) {
        if (err) return res.status(500).json({ message: 'Unable to change password.' });
        logActivity(req.user.user_id, 'Changed password', user.full_name + ' changed password');
        return res.status(200).json({ message: 'Password changed successfully.' });
      }
    );
  });
});

function deleteUserAccount(req, res) {
  const userId = parseInt(req.params.id, 10);
  if (!Number.isInteger(userId)) return res.status(400).json({ message: 'Invalid account selected.' });
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ message: 'Only the super admin can delete staff accounts.' });
  }
  if (userId === req.user.user_id) {
    return res.status(400).json({ message: 'You cannot delete your own account while logged in.' });
  }

  db.get('SELECT user_id, username, full_name, role FROM users WHERE user_id = ?', [userId], function(err, user) {
    if (err) return res.status(500).json({ message: 'Database error.' });
    if (!user) return res.status(404).json({ message: 'Account not found.' });

    db.get(
      'SELECT COUNT(*) as total FROM users WHERE role IN ("super_admin", "admin") AND status = "Active" AND user_id != ?',
      [userId],
      function(err, row) {
        if (err) return res.status(500).json({ message: 'Database error.' });
        if ((user.role === 'admin' || user.role === 'super_admin') && row.total === 0) {
          return res.status(400).json({ message: 'At least one active admin account must remain.' });
        }

        db.get(
          `SELECT COUNT(*) as total
           FROM transactions t
           JOIN borrowers b ON t.borrower_id = b.borrower_id
           WHERE b.user_id = ?
             AND (t.status IN ('Pending', 'Approved', 'Released', 'Overdue')
               OR (t.due_date < date('now') AND t.status = 'Released')
               OR (t.return_status IN ('Damaged', 'Incomplete') AND b.is_flagged = 1))`,
          [userId],
          function(err, blocked) {
            if (err) return res.status(500).json({ message: 'Unable to check account borrowings.' });
            if (blocked.total > 0) {
              return res.status(400).json({
                message: 'This account cannot be deleted because it has pending, active, overdue, or unsettled borrowed items.'
              });
            }

            db.run('DELETE FROM borrowers WHERE user_id = ?', [userId], function(err) {
              if (err) return res.status(500).json({ message: 'Unable to delete borrower profile.' });
              db.run('DELETE FROM users WHERE user_id = ?', [userId], function(err) {
                if (err) return res.status(500).json({ message: 'Unable to delete account.' });
                logActivity(req.user.user_id, 'Deleted account', user.full_name + ' (' + user.username + ')');
                return res.status(200).json({ message: 'Account deleted successfully!' });
              });
            });
          }
        );
      }
    );
  });
}

router.delete('/users/:id', auth, admin, deleteUserAccount);
router.post('/users/:id/delete', auth, admin, deleteUserAccount);

module.exports = router;

