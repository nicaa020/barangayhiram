'use strict';

const net = require('net');
const tls = require('tls');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

function isConfigured() {
  return Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM);
}

function encodeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function dotStuff(value) {
  return String(value || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function createSmtpSession() {
  let socket;
  let buffer = '';

  function connectPlain() {
    return new Promise(function(resolve, reject) {
      socket = SMTP_SECURE
        ? tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST }, resolve)
        : net.connect({ host: SMTP_HOST, port: SMTP_PORT }, resolve);
      socket.setTimeout(15000);
      socket.on('error', reject);
      socket.on('timeout', function() {
        socket.destroy(new Error('SMTP connection timed out.'));
      });
      socket.on('data', function(chunk) {
        buffer += chunk.toString('utf8');
      });
    });
  }

  function readResponse() {
    return new Promise(function(resolve, reject) {
      function check() {
        const lines = buffer.split(/\r?\n/).filter(Boolean);
        if (lines.length) {
          const last = lines[lines.length - 1];
          if (/^\d{3} /.test(last)) {
            const text = buffer;
            buffer = '';
            const code = Number(last.slice(0, 3));
            if (code >= 400) reject(new Error(text.replace(/\s+/g, ' ').trim()));
            else resolve(text);
            return;
          }
        }
        setTimeout(check, 20);
      }
      check();
    });
  }

  async function command(line) {
    socket.write(line + '\r\n');
    return readResponse();
  }

  async function startTls() {
    await command('STARTTLS');
    socket = tls.connect({ socket: socket, servername: SMTP_HOST });
    buffer = '';
    await new Promise(function(resolve, reject) {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
    socket.on('data', function(chunk) {
      buffer += chunk.toString('utf8');
    });
  }

  return { connectPlain, readResponse, command, startTls, get socket() { return socket; } };
}

async function sendMail(options) {
  if (!isConfigured()) {
    return { sent: false, skipped: true, message: 'SMTP email is not configured.' };
  }

  const to = encodeHeader(options.to);
  const subject = encodeHeader(options.subject);
  const text = String(options.text || '').trim();
  const html = String(options.html || '').trim();
  if (!to || !subject || (!text && !html)) {
    throw new Error('Email recipient, subject, and message are required.');
  }

  const session = createSmtpSession();
  await session.connectPlain();
  await session.readResponse();
  await session.command('EHLO barangayhiram.local');
  if (!SMTP_SECURE) {
    await session.startTls();
    await session.command('EHLO barangayhiram.local');
  }
  await session.command('AUTH PLAIN ' + Buffer.from('\u0000' + SMTP_USER + '\u0000' + SMTP_PASS).toString('base64'));
  await session.command('MAIL FROM:<' + SMTP_USER + '>');
  await session.command('RCPT TO:<' + to + '>');
  await session.command('DATA');

  const boundary = 'barangayhiram-' + Date.now();
  const fromHeader = SMTP_FROM.includes('<') ? SMTP_FROM : 'BarangayHiram <' + SMTP_FROM + '>';
  const body = [
    'From: ' + encodeHeader(fromHeader),
    'To: ' + to,
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    dotStuff(text || html.replace(/<[^>]+>/g, ' ')),
    '--' + boundary,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    dotStuff(html || '<p>' + text.replace(/\n/g, '<br>') + '</p>'),
    '--' + boundary + '--',
    '.'
  ].join('\r\n');

  session.socket.write(body + '\r\n');
  await session.readResponse();
  await session.command('QUIT');
  session.socket.end();
  return { sent: true, skipped: false };
}

async function sendBorrowerReadyEmail(user) {
  const name = user.full_name || 'Borrower';
  const loginUrl = (process.env.APP_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '') + '/pages/login.html';
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

module.exports = {
  isConfigured,
  sendMail,
  sendBorrowerReadyEmail
};
