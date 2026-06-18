'use strict';

module.exports = function(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'staff')) {
    return res.status(403).json({ message: 'Admin access is required.' });
  }
  next();
};
