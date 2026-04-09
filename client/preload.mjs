// Exposes the server URL to the renderer via a known global.
// process.defaultApp is true when launched as "electron ." (development), false in packaged app.
const isDev = !!process.defaultApp;
const envUrl = process.env.WEEFLASH_SERVER_URL;
window.WEEFLASH_SERVER_URL = envUrl || (isDev ? 'http://localhost:3000' : 'https://brawl.weeqlash.icu');
