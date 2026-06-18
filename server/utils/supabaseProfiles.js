'use strict';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && typeof fetch === 'function');
}

async function supabaseRequest(path, options, key) {
  const apiKey = key || SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(SUPABASE_URL + path, {
    method: options.method,
    headers: Object.assign({
      apikey: apiKey,
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    }, options.headers || {}),
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const message = data && (data.msg || data.message || data.error_description || data.error);
    throw new Error(message || 'Supabase request failed.');
  }

  return data;
}

async function signUpAuthUser(email, password, metadata, emailRedirectTo) {
  const redirectPath = emailRedirectTo ? '?redirect_to=' + encodeURIComponent(emailRedirectTo) : '';
  return supabaseRequest('/auth/v1/signup' + redirectPath, {
    method: 'POST',
    body: {
      email: email,
      password: password,
      data: metadata || {}
    }
  }, SUPABASE_ANON_KEY);
}

async function getAuthUser(userId) {
  return supabaseRequest('/auth/v1/admin/users/' + encodeURIComponent(userId), {
    method: 'GET'
  });
}

function wait(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

async function waitForAuthUser(userId) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await getAuthUser(userId);
    } catch (err) {
      lastError = err;
      await wait(250 * (attempt + 1));
    }
  }
  throw lastError || new Error('Supabase Auth user was not found after signup.');
}

async function deleteAuthUser(userId) {
  if (!userId) return;
  try {
    await supabaseRequest('/auth/v1/admin/users/' + encodeURIComponent(userId), {
      method: 'DELETE'
    });
  } catch (err) {
    console.warn('Unable to rollback Supabase Auth user:', err.message);
  }
}

async function createProfile(profile) {
  return supabaseRequest('/rest/v1/profiles', {
    method: 'POST',
    headers: {
      Prefer: 'return=representation'
    },
    body: profile
  });
}

async function createBorrowerProfileAccount(details) {
  if (!isConfigured()) {
    return { skipped: true };
  }

  const authData = await signUpAuthUser(details.email, details.password, {
    full_name: details.full_name,
    role: 'borrower',
    borrower_type: details.borrower_type
  }, details.email_redirect_to);

  const authUser = authData && (authData.user || authData);
  const authUserId = authUser && authUser.id;
  if (!authUserId) {
    throw new Error('Supabase Auth did not return a user id.');
  }

  let confirmedAuthUser = authUser;
  try {
    confirmedAuthUser = await waitForAuthUser(authUserId);
    const profileRows = await createProfile({
      id: authUserId,
      full_name: details.full_name,
      email: details.email,
      contact_number: details.contact_number,
      address: details.address,
      role: 'borrower',
      borrower_type: details.borrower_type,
      account_status: 'Pending',
      verification_document_url: details.verification_document_url || null,
      admin_remarks: null
    });

    return {
      skipped: false,
      auth_user_id: authUserId,
      email_confirmed_at: authUser.email_confirmed_at || authUser.confirmed_at || null,
      profile: Array.isArray(profileRows) ? profileRows[0] : profileRows
    };
  } catch (err) {
    if (!String(err.message || '').includes('profiles_id_fkey')) {
      await deleteAuthUser(authUserId);
      throw err;
    }
    return {
      skipped: false,
      auth_user_id: authUserId,
      email_confirmed_at: confirmedAuthUser.email_confirmed_at || confirmedAuthUser.confirmed_at || null,
      profile: null,
      profile_sync_error: err.message
    };
  }
}

module.exports = {
  isConfigured,
  createBorrowerProfileAccount,
  getAuthUser,
  deleteAuthUser
};
