'use strict';
const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
  const token = req.headers['authorization'];

  if (!token) {
    return res.status(401).json({ message: 'Access denied. Please log in.' });
  }

  const secret = process.env.JWT_SECRET || 'barangayhiram_secret_key_2024';

  jwt.verify(token, secret, function(err, decoded) {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token.' });
    }
    req.user = decoded;
    next();
  });
};