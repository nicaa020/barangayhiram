'use strict';

const appUrl = require('./appUrl');

const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const EMAIL_FROM = String(process.env.EMAIL_FROM || 'BarangayHiram <onboarding@resend.dev>').trim();

function isConfigured() {
  return Boolean(RESEND_API_KEY && EMAIL_FROM && typeof fetch === 'function');
}

function encodeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

async function sendMail(options) {
  if (!isConfigured()) {
    return { sent: false, skipped: true, message: 'Resend email is not configured.' };
  }

  const to = encodeHeader(options.to);
  const subject = encodeHeader(options.subject);
  const text = String(options.text || '').trim();
  const html = String(options.html || '').trim();
  if (!to || !subject || (!text && !html)) {
    throw new Error('Email recipient, subject, and message are required.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject: subject,
      text: text || html.replace(/<[^>]+>/g, ' '),
      html: html || '<p>' + text.replace(/\n/g, '<br>') + '</p>'
    })
  });

  const responseText = await response.text();
  let data = null;
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch (err) {
      data = { message: responseText };
    }
  }

  if (!response.ok) {
    throw new Error((data && (data.message || data.error)) || 'Resend email request failed.');
  }

  return { sent: true, skipped: false, id: data && data.id };
}

async function sendBorrowerReadyEmail(user) {
  const name = user.full_name || 'Borrower';
  const loginUrl = appUrl.loginUrl('http://127.0.0.1:3001');
  return sendMail({
    to: user.email || user.username,
    subject: 'Your BarangayHiram account is approved',
    text:
      'Hello ' + name + ',\n\n' +
      'Your BarangayHiram borrower account has been verified and approved by barangay staff.\n\n' +
      'You may now log in and submit equipment borrowing requests.\n\n' +
      'Login here: ' + loginUrl + '\n\n' +
      'BarangayHiram\nBarangay 628, Zone 63',
    html:
      '<p>Hello ' + encodeHeader(name) + ',</p>' +
      '<p>Your BarangayHiram borrower account has been verified and approved by barangay staff.</p>' +
      '<p>You may now log in and submit equipment borrowing requests.</p>' +
      '<p><a href="' + loginUrl + '">Log in to BarangayHiram</a></p>' +
      '<p>BarangayHiram<br>Barangay 628, Zone 63</p>'
  });
}

async function sendRequestStatusEmail(user, request, status, reason) {
  const name = user.full_name || request.borrower_name || 'Borrower';
  const requestLabel = 'Request #' + request.transaction_id;
  let subject = 'BarangayHiram borrowing request update';
  let statusMessage = requestLabel + ' for ' + request.equipment_name + ' has been updated to ' + status + '.';

  if (status === 'Approved') {
    subject = 'Your BarangayHiram borrowing request is approved';
    statusMessage = requestLabel + ' for ' + request.equipment_name + ' has been approved. Please wait for staff release instructions.';
  } else if (status === 'Rejected') {
    subject = 'Your BarangayHiram borrowing request was rejected';
    statusMessage = requestLabel + ' for ' + request.equipment_name + ' was rejected. ' + (reason ? 'Reason: ' + reason : 'Please contact barangay staff for details.');
  } else if (status === 'Released') {
    subject = 'Your BarangayHiram equipment has been released';
    statusMessage = requestLabel + ' for ' + request.equipment_name + ' has been released. Please return it on or before ' + (request.due_date || 'the expected return date') + '.';
  }

  return sendMail({
    to: user.email || user.username,
    subject: subject,
    text:
      'Hello ' + name + ',\n\n' +
      statusMessage + '\n\n' +
      'BarangayHiram\nBarangay 628, Zone 63',
    html:
      '<p>Hello ' + encodeHeader(name) + ',</p>' +
      '<p>' + encodeHeader(statusMessage) + '</p>' +
      '<p>BarangayHiram<br>Barangay 628, Zone 63</p>'
  });
}

async function sendOverdueEmail(user, request) {
  const name = user.full_name || request.borrower_name || 'Borrower';
  const message = 'Request #' + request.transaction_id + ' for ' + request.equipment_name + ' is overdue. Please return the equipment immediately.';

  return sendMail({
    to: user.email || user.username,
    subject: 'BarangayHiram overdue equipment notice',
    text:
      'Hello ' + name + ',\n\n' +
      message + '\n\n' +
      'Expected return date: ' + (request.due_date || '-') + '\n\n' +
      'BarangayHiram\nBarangay 628, Zone 63',
    html:
      '<p>Hello ' + encodeHeader(name) + ',</p>' +
      '<p>' + encodeHeader(message) + '</p>' +
      '<p>Expected return date: ' + encodeHeader(request.due_date || '-') + '</p>' +
      '<p>BarangayHiram<br>Barangay 628, Zone 63</p>'
  });
}

module.exports = {
  isConfigured,
  sendMail,
  sendBorrowerReadyEmail,
  sendRequestStatusEmail,
  sendOverdueEmail
};
