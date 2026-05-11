require('dotenv').config();

const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

require('./database/db');

const authRoutes         = require('./routes/auth');
const equipmentRoutes    = require('./routes/equipment');
const borrowersRoutes    = require('./routes/borrowers');
const transactionsRoutes = require('./routes/transactions');
const returnsRoutes      = require('./routes/returns');
const dashboardRoutes    = require('./routes/dashboard');
const activityRoutes     = require('./routes/activity');

app.use('/api/auth',         authRoutes);
app.use('/api/equipment',    equipmentRoutes);
app.use('/api/borrowers',    borrowersRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/returns',      returnsRoutes);
app.use('/api/dashboard',    dashboardRoutes);
app.use('/api/activity',     activityRoutes);

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
