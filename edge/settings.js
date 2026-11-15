/**
 * Node-RED settings for the Smart Kanban edge gateway.
 *
 * Only the settings this project needs; everything else keeps the Node-RED default.
 * Full reference: https://nodered.org/docs/user-guide/runtime/configuration
 *
 * In Docker this file is /data/settings.js (the edge/ folder is mounted on /data).
 */
const path = require('path');

/** Load a module from the userDir or from where Node-RED itself is installed (Docker image). */
function load(name) {
  return require(require.resolve(name, {
    paths: [__dirname, process.cwd(), path.dirname(require.main.filename), '/usr/src/node-red'],
  }));
}

module.exports = {
  flowFile: 'flows.json',
  flowFilePretty: true,

  // Credentials only hold ${MQTT_USER} / ${MQTT_PASS} placeholders, never real
  // values, so the credentials file is stored unencrypted and can be committed.
  credentialSecret: false,

  uiPort: process.env.PORT || 1880,

  // T4.7 - the 3D shelf twin (docs/twin) at http://localhost:1880/twin/
  // In Docker docs/twin is mounted on /twin; elsewhere set TWIN_DIR.
  httpStatic: [{ path: process.env.TWIN_DIR || '/twin', root: '/twin/' }],

  // Shared with every Function node through global.get(...)
  functionGlobalContext: {
    ModbusRTU: load('modbus-serial'),                                    // Modbus TCP client
    p240: require(path.join(__dirname, 'lib', 'p240.js')),               // P-240 rule (T2.5)
    epcis: require(path.join(__dirname, 'lib', 'epcis.js')),             // EPCIS events (T3.7)
    bins: require(process.env.BINS_CONFIG || '/config/bins.json'),       // config/bins.json (T2.1)
  },

  // 'file' keeps the store-and-forward queue on disk so it survives a restart (T3.3)
  contextStorage: {
    default: { module: 'memory' },
    file: { module: 'localfilesystem', config: { flushInterval: 5 } },
  },

  logging: {
    console: { level: 'info', metrics: false, audit: false },
  },

  editorTheme: {
    projects: { enabled: false },
  },
};
