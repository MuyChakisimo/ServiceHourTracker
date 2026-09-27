/* Cloud sync provider configuration.
 *
 * Fill in the public client IDs from your own developer accounts to enable a
 * provider (see CLOUD_SYNC_SETUP.md). Leave a value empty to hide that
 * provider. These IDs are public identifiers, not secrets. Never put a
 * client secret in this file: the app uses secret-free flows only.
 */
(function (root) {
    const STT = root.STT = root.STT || {};
    STT.cloudConfig = {
        // Page the providers redirect back to after sign-in (relative to index.html).
        redirectPath: 'oauth-callback.html',

        // Google Cloud Console > APIs & Services > Credentials > OAuth client ID (type "Web application").
        google: { clientId: '' },

        // Microsoft Entra admin center > App registrations > Application (client) ID.
        // tenant: 'common' (personal + work/school), 'consumers' (personal only) or a tenant ID.
        onedrive: { clientId: '', tenant: 'common' },

        // Dropbox App Console > your app > "App key" (Scoped access, App folder).
        dropbox: { clientId: '' }
    };
})(typeof self !== 'undefined' ? self : globalThis);
