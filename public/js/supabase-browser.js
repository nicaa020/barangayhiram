(function() {
  let clientPromise = null;

  window.getBarangayHiramSupabase = function() {
    if (clientPromise) return clientPromise;

    clientPromise = fetch('/api/auth/supabase-public-config')
      .then(function(response) {
        return response.json();
      })
      .then(function(config) {
        if (!config.url || !config.anon_key) {
          throw new Error('Supabase Auth is not configured.');
        }
        if (!window.supabase || !window.supabase.createClient) {
          throw new Error('Supabase client library failed to load.');
        }
        return window.supabase.createClient(config.url, config.anon_key);
      });

    return clientPromise;
  };
})();
