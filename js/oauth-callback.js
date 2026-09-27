/* Sign-in callback (loaded by oauth-callback.html).
 * The provider sends the user back with a one-time code (or, for Google, a
 * short-lived token) in the URL. Hand it to the app through localStorage and
 * return to the app at once, replacing this page in history so the URL is not
 * kept. The app validates it against the request it started and deletes it. */
try {
    localStorage.setItem('stt.oauth.result', JSON.stringify({ query: location.search, hash: location.hash, at: Date.now() }));
} catch (e) { /* storage blocked: the app will report that sign-in did not complete */ }
location.replace('./index.html');
