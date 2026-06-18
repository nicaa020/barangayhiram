'use strict';

function getAppUrl(fallback) {
  const rawUrl = (process.env.APP_URL || process.env.PUBLIC_APP_URL || fallback || '').trim();
  if (!rawUrl) return '';

  let appUrl = rawUrl.replace(/\/+$/, '');
  appUrl = appUrl.replace(/\/pages\/login\.html(?:\?.*)?$/i, '');
  return appUrl.replace(/\/+$/, '');
}

function loginUrl(fallback, queryString) {
  const appUrl = getAppUrl(fallback);
  const query = queryString ? (queryString.charAt(0) === '?' ? queryString : '?' + queryString) : '';
  return appUrl + '/pages/login.html' + query;
}

module.exports = {
  getAppUrl,
  loginUrl
};
