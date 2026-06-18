require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

require('./database/db');

const authRoutes         = require('./routes/auth');
const equipmentRoutes    = require('./routes/equipment');
const borrowersRoutes    = require('./routes/borrowers');
const transactionsRoutes = require('./routes/transactions');
const returnsRoutes      = require('./routes/returns');
const dashboardRoutes    = require('./routes/dashboard');
const activityRoutes     = require('./routes/activity');
const notificationsRoutes = require('./routes/notifications');

app.use('/api/auth',         authRoutes);
app.use('/api/equipment',    equipmentRoutes);
app.use('/api/borrowers',    borrowersRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/returns',      returnsRoutes);
app.use('/api/dashboard',    dashboardRoutes);
app.use('/api/activity',     activityRoutes);
app.use('/api/notifications', notificationsRoutes);

const publicDir = path.join(__dirname, '..', 'public');
const borrowerPages = {
  '/borrower/dashboard': 'dashboard.html',
  '/borrower/equipment': 'equipment.html',
  '/borrower/request': 'request.html',
  '/borrower/requests': 'requests.html',
  '/borrower/profile': 'profile.html',
  '/borrower/notifications': 'notifications.html',
  '/verification-status': 'verification-status.html'
};

Object.keys(borrowerPages).forEach(function(route) {
  app.get(route, function(req, res) {
    res.sendFile(path.join(publicDir, 'borrower', borrowerPages[route]));
  });
});

app.get('/borrower/equipment/:id', function(req, res) {
  res.sendFile(path.join(publicDir, 'borrower', 'equipment-detail.html'));
});

app.get('/borrower/requests/:id', function(req, res) {
  res.sendFile(path.join(publicDir, 'borrower', 'request-detail.html'));
});

app.get('/forgot-password', function(req, res) {
  res.sendFile(path.join(publicDir, 'pages', 'forgot-password.html'));
});

app.get('/reset-password', function(req, res) {
  res.sendFile(path.join(publicDir, 'pages', 'reset-password.html'));
});

app.get('/login', function(req, res) {
  res.redirect('/pages/login.html');
});

app.get('/', function(req, res) {
  res.redirect('/pages/login.html');
});

app.get('/api', function(req, res) {
  res.json({ 
    message: 'BarangayHiram Server is running!',
    version: '1.0.0'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('✅ Server is running at http://localhost:' + PORT);
});

process.on('uncaughtException', function(err) {
  console.error('Uncaught error:', err.message);
});
