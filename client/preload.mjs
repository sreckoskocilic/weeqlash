// Exposes the server URL to the renderer via a known global.
// process.defaultApp is true when launched as "electron ." (development), false in packaged app.
const isDev = !!process.defaultApp;
window.SRAZ_SERVER_URL = isDev ? 'http://localhost:3000' : 'https://sraz.nbastables.com';
