'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const logActivity = require('../utils/activity');

router.post('/register', auth, admin, function(req, res) {
  const username = req.body.username;
  const password = req.body.password;
  const full_name = req.body.full_name;
  const role = req.body.role || 'staff';

  if (!username || !password || !full_name) {
    return res.status(400).json({ message: 'Please fill in all fields.' });
  }
  if (role !== 'admin' && role !== 'staff') {
    return res.status(400).json({ message: 'Invalid role selected.' });
  }

  const hashed = bcrypt.hashSync(password, 10);

  db.run(
    'INSERT INTO users (username, password, full_name, role, status) VALUES (?, ?, ?, ?, ?)',
    [username, hashed, full_name, role, 'Active'],
    function(err) {
      if (err) {
        return res.status(400).json({ message: 'Username already exists.' });
      }
      logActivity(req.user.user_id, 'Created staff account', full_name + ' (' + username + ') as ' + role);
      return res.status(200).json({ message: 'Account created successfully!' });
    }
  );
});

router.post('/login', function(req, res) {
  const username = req.body.username;
  const password = req.body.password;

  if (!username || !password) {
    return res.status(400).json({ message: 'Please enter username and password.' });
  }

  db.get(
    'SELECT * FROM users WHERE username = ?',
    [username],
    function(err, user) {
      if (err) {
        return res.status(500).json({ message: 'Database error.' });
      }
      if (!user) {
        return res.status(400).json({ message: 'User not found.' });
      }
      if (user.status === 'Inactive') {
        return res.status(403).json({ message: 'This account is inactive. Please contact the administrator.' });
      }

      const validPassword = bcrypt.compareSync(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ message: 'Incorrect password.' });
      }

      const secret = process.env.JWT_SECRET || 'barangayhiram_secret_key_2024';
      const token = jwt.sign(
        {
          user_id: user.user_id,
          role: user.role,
          full_name: user.full_name
        },
        secret,
        { expiresIn: '8h' }
      );

      logActivity(user.user_id, 'Logged in', user.full_name + ' signed in');

      return res.status(200).json({
        message: 'Login successful!',
        token: token,
        user: {
          user_id: user.user_id,
          username: user.username,
          full_name: user.full_name,
          role: user.role
        }
      });
    }
  );
});

router.get('/users', auth, admin, function(req, res) {
  db.all(
    'SELECT user_id, username, full_name, role, status, created_at FROM users ORDER BY created_at DESC',
    [],
    function(err, rows) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }
      return res.status(200).json(rows);
    }
  );
});

router.put('/users/:id', auth, admin, function(req, res) {
  const full_name = req.body.full_name;
  const username = req.body.username;
  const role = req.body.role;
  const status = req.body.status;
  const password = req.body.password;

  if (!username || !full_name || !role || !status) {
    return res.status(400).json({ message: 'Please fill in all required fields.' });
  }
  if (role !== 'admin' && role !== 'staff') {
    return res.status(400).json({ message: 'Invalid role selected.' });
  }
  if (status !== 'Active' && status !== 'Inactive') {
    return res.status(400).json({ message: 'Invalid account status selected.' });
  }

  function finishUpdate(sql, params) {
    db.run(sql, params, function(err) {
      if (err) {
        return res.status(400).json({ message: 'Username already exists.' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'Account not found.' });
      }
      logActivity(req.user.user_id, 'Updated staff account', full_name + ' (' + username + ')');
      return res.status(200).json({ message: 'Account updated successfully!' });
    });
  }

  if (password) {
    const hashed = bcrypt.hashSync(password, 10);
    finishUpdate(
      'UPDATE users SET username = ?, password = ?, full_name = ?, role = ?, status = ? WHERE user_id = ?',
      [username, hashed, full_name, role, status, req.params.id]
    );
  } else {
    finishUpdate(
      'UPDATE users SET username = ?, full_name = ?, role = ?, status = ? WHERE user_id = ?',
      [username, full_name, role, status, req.params.id]
    );
  }
});

function deleteUserAccount(req, res) {
  const userId = parseInt(req.params.id, 10);

  if (!Number.isInteger(userId)) {
    return res.status(400).json({ message: 'Invalid account selected.' });
  }
  if (userId === req.user.user_id) {
    return res.status(400).json({ message: 'You cannot delete your own account while logged in.' });
  }

  db.get(
    'SELECT user_id, username, full_name, role FROM users WHERE user_id = ?',
    [userId],
    function(err, user) {
      if (err) {
        return res.status(500).json({ message: 'Database error.' });
      }
      if (!user) {
        return res.status(404).json({ message: 'Account not found.' });
      }

      db.get(
        'SELECT COUNT(*) as total FROM users WHERE role = ? AND status = ? AND user_id != ?',
        ['admin', 'Active', userId],
        function(err, row) {
          if (err) {
            return res.status(500).json({ message: 'Database error.' });
          }
          if (user.role === 'admin' && row.total === 0) {
            return res.status(400).json({ message: 'At least one active admin account must remain.' });
          }

          db.run('DELETE FROM users WHERE user_id = ?', [userId], function(err) {
            if (err) {
              return res.status(500).json({ message: 'Unable to delete account.' });
            }
            logActivity(
              req.user.user_id,
              'Deleted staff account',
              user.full_name + ' (' + user.username + ')'
            );
            return res.status(200).json({ message: 'Account deleted successfully!' });
          });
        }
      );
    }
  );
}

router.delete('/users/:id', auth, admin, deleteUserAccount);
router.post('/users/:id/delete', auth, admin, deleteUserAccount);

module.exports = router;
