// Exposes the server URL to the renderer; process.defaultApp is true in dev ("electron ."), false when packaged.
const isDev = !!process.defaultApp;
const envUrl = process.env.WEEFLASH_SERVER_URL;
window.WEEFLASH_SERVER_URL =
  envUrl || (isDev ? 'http://localhost:3000' : 'https://brawl.weeqlash.icu');
