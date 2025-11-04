// Optionaler Hook für Notarization mit Apple, falls ENV-Variablen vorhanden sind.
// Erwartet: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
const { notarize } = require('@electron/notarize');

module.exports = async function afterSign(context) {
  const appleId = process.env.APPLE_ID;
  const applePassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !applePassword || !teamId) {
    // Kein Notarization-Setup vorhanden – überspringen
    return;
  }

  if (process.platform !== 'darwin') {
    return;
  }

  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;

  await notarize({
    appBundleId: 'com.meetropolis.app',
    appPath: `${appOutDir}/${appName}.app`,
    appleId,
    appleIdPassword: applePassword,
    teamId
  });
};


