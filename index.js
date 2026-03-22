'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var BluetoothManager = require('./lib/bluetoothManager');
var AudioService = require('./lib/audioService');

module.exports = ControllerBluetoothInput;

function ControllerBluetoothInput(context) {
  var self = this;
  self.context = context;
  self.commandRouter = self.context.coreCommand;
  self.logger = self.context.logger;
  self.configManager = self.context.configManager;
  self.btManager = null;
  self.audioService = null;
}

// --- Lifecycle ---

ControllerBluetoothInput.prototype.onVolumioStart = function () {
  var self = this;
  var configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);
  return libQ.resolve();
};

ControllerBluetoothInput.prototype.onStart = function () {
  var self = this;
  var defer = libQ.defer();

  self.btManager = new BluetoothManager(self.logger);
  self.audioService = new AudioService(self.logger);

  var deviceName = self.config.get('deviceName') || 'Volumio';
  var discoverable = self.config.get('discoverable') !== false;
  var outputDevice = self.commandRouter.sharedVars.get('alsa.outputdevice') || 'softvolume';

  self.btManager.isAdapterPresent()
    .then(function (present) {
      if (!present) {
        self.commandRouter.pushToastMessage('error', 'Bluetooth Audio Input', self._t('NO_BT_ADAPTER'));
        defer.reject(new Error('No Bluetooth adapter'));
        return;
      }

      return self.btManager.initialize(deviceName, discoverable)
        .then(function () {
          return self.audioService.start(outputDevice);
        })
        .then(function () {
          self._registerCallbacks();
          self.logger.info('ControllerBluetoothInput started');
          defer.resolve();
        });
    })
    .catch(function (err) {
      self.logger.error('ControllerBluetoothInput::onStart failed: ' + err);
      self.commandRouter.pushToastMessage('error', 'Bluetooth Audio Input', self._t('SERVICE_START_FAILED'));
      defer.reject(err);
    });

  return defer.promise;
};

ControllerBluetoothInput.prototype.onStop = function () {
  var self = this;
  var defer = libQ.defer();

  self._unregisterCallbacks();

  var chain = Promise.resolve();

  if (self.audioService) {
    chain = chain.then(function () {
      return self.audioService.stop();
    });
  }

  if (self.btManager) {
    chain = chain.then(function () {
      return self.btManager.shutdown();
    });
  }

  chain
    .then(function () {
      self.btManager = null;
      self.audioService = null;
      self.logger.info('ControllerBluetoothInput stopped');
      defer.resolve();
    })
    .catch(function (err) {
      self.logger.error('ControllerBluetoothInput::onStop error: ' + err);
      defer.resolve();
    });

  return defer.promise;
};

ControllerBluetoothInput.prototype.onRestart = function () {
  var self = this;
  return self.onStop().then(function () {
    return self.onStart();
  });
};

// --- Configuration ---

ControllerBluetoothInput.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

ControllerBluetoothInput.prototype.getUIConfig = function () {
  var defer = libQ.defer();
  var self = this;
  var langCode = self.commandRouter.sharedVars.get('language_code');

  self.commandRouter.i18nJson(
    __dirname + '/i18n/strings_' + langCode + '.json',
    __dirname + '/i18n/strings_en.json',
    __dirname + '/UIConfig.json'
  )
    .then(function (uiconf) {
      // General settings
      uiconf.sections[0].content[0].value = self.config.get('deviceName') || 'Volumio';
      uiconf.sections[0].content[1].value = self.config.get('discoverable') !== false;
      uiconf.sections[0].content[2].value = self.config.get('autoAccept') !== false;

      // Paired devices - populate dynamically
      if (self.btManager) {
        return self.btManager.getPairedDevices().then(function (devices) {
          var section = uiconf.sections[1];
          section.content = [];

          if (devices.length === 0) {
            section.content.push({
              id: 'no_devices',
              element: 'button',
              label: self._t('NO_PAIRED_DEVICES'),
              doc: '',
              onClick: { type: 'emit', message: '', data: '' }
            });
          } else {
            devices.forEach(function (device) {
              section.content.push({
                id: 'remove_' + device.mac.replace(/:/g, ''),
                element: 'button',
                label: device.name + ' (' + device.mac + ')',
                doc: '',
                onClick: {
                  type: 'emit',
                  message: 'callMethod',
                  data: {
                    endpoint: 'audio_interface/bluetooth_input',
                    method: 'removeDevice',
                    data: { mac: device.mac, name: device.name }
                  },
                  askForConfirm: {
                    title: self._t('REMOVE_CONFIRM_TITLE'),
                    message: self._t('REMOVE_CONFIRM_MESSAGE')
                  }
                }
              });
            });
          }

          defer.resolve(uiconf);
        });
      } else {
        defer.resolve(uiconf);
      }
    })
    .fail(function (err) {
      self.logger.error('ControllerBluetoothInput::getUIConfig failed: ' + err);
      defer.reject(new Error());
    });

  return defer.promise;
};

// --- Settings handlers ---

ControllerBluetoothInput.prototype.saveSettings = function (data) {
  var self = this;

  if (data.deviceName !== undefined) {
    self.config.set('deviceName', data.deviceName);
  }
  if (data.discoverable !== undefined) {
    self.config.set('discoverable', data.discoverable);
  }
  if (data.autoAccept !== undefined) {
    self.config.set('autoAccept', data.autoAccept);
  }

  if (self.btManager) {
    if (data.deviceName) {
      self.btManager.setAlias(data.deviceName);
    }
    if (data.discoverable !== undefined) {
      self.btManager.setDiscoverable(data.discoverable);
    }
  }

  self.commandRouter.pushToastMessage('success', 'Bluetooth Audio Input', self._t('SETTINGS_SAVED'));
};

ControllerBluetoothInput.prototype.scanForDevices = function () {
  var self = this;

  if (!self.btManager) {
    return libQ.resolve();
  }

  self.commandRouter.pushToastMessage('info', 'Bluetooth Audio Input', self._t('SCANNING'));

  return self.btManager.startScan(10000)
    .then(function (devices) {
      if (devices.length === 0) {
        self.commandRouter.pushToastMessage('info', 'Bluetooth Audio Input', self._t('NO_DEVICES_FOUND'));
      } else {
        self.commandRouter.pushToastMessage('success', 'Bluetooth Audio Input',
          self._t('SCAN_COMPLETE') + ': ' + devices.length + ' ' + self._t('DEVICES_FOUND'));
      }
      // Refresh the UI to show scan results
      self.commandRouter.getUIConfigOnPlugin('audio_interface', 'bluetooth_input', {});
    })
    .catch(function (err) {
      self.logger.error('ControllerBluetoothInput::scanForDevices error: ' + err);
    });
};

ControllerBluetoothInput.prototype.pairDevice = function (data) {
  var self = this;

  if (!self.btManager || !data || !data.mac) {
    return libQ.resolve();
  }

  return self.btManager.pairDevice(data.mac)
    .then(function () {
      self.commandRouter.pushToastMessage('success', 'Bluetooth Audio Input',
        self._t('PAIR_SUCCESS') + ': ' + (data.name || data.mac));
      self.commandRouter.getUIConfigOnPlugin('audio_interface', 'bluetooth_input', {});
    })
    .catch(function (err) {
      self.logger.error('ControllerBluetoothInput::pairDevice error: ' + err);
      self.commandRouter.pushToastMessage('error', 'Bluetooth Audio Input',
        self._t('PAIR_FAILED') + ': ' + (data.name || data.mac));
    });
};

ControllerBluetoothInput.prototype.removeDevice = function (data) {
  var self = this;

  if (!self.btManager || !data || !data.mac) {
    return libQ.resolve();
  }

  if (self.audioService) {
    self.audioService.stopAplay(data.mac);
  }

  return self.btManager.removeDevice(data.mac)
    .then(function () {
      self.commandRouter.pushToastMessage('success', 'Bluetooth Audio Input',
        self._t('REMOVE_SUCCESS') + ': ' + (data.name || data.mac));
      self.commandRouter.getUIConfigOnPlugin('audio_interface', 'bluetooth_input', {});
    })
    .catch(function (err) {
      self.logger.error('ControllerBluetoothInput::removeDevice error: ' + err);
      self.commandRouter.pushToastMessage('error', 'Bluetooth Audio Input',
        self._t('REMOVE_FAILED') + ': ' + (data.name || data.mac));
    });
};

// --- Callbacks ---

ControllerBluetoothInput.prototype._registerCallbacks = function () {
  var self = this;

  self.commandRouter.sharedVars.registerCallback('alsa.outputdevice', self.onOutputDeviceChanged.bind(self));

  if (self.btManager) {
    self.btManager.on('deviceConnected', function (device) {
      self.logger.info('ControllerBluetoothInput::BT device connected: ' + device.mac);
      self.commandRouter.pushToastMessage('info', self._t('BT_CONNECTED'),
        self._t('STREAMING_FROM') + ' ' + device.name);

      if (self.audioService) {
        self.audioService.startAplay(device.mac);
      }
    });

    self.btManager.on('deviceDisconnected', function (device) {
      self.logger.info('ControllerBluetoothInput::BT device disconnected: ' + device.mac);
      self.commandRouter.pushToastMessage('info', self._t('BT_DISCONNECTED'), device.mac);

      if (self.audioService) {
        self.audioService.stopAplay(device.mac);
      }
    });
  }
};

ControllerBluetoothInput.prototype._unregisterCallbacks = function () {
  var self = this;
  if (self.btManager) {
    self.btManager.removeAllListeners();
  }
};

ControllerBluetoothInput.prototype.onOutputDeviceChanged = function () {
  var self = this;
  var newDevice = self.commandRouter.sharedVars.get('alsa.outputdevice') || 'softvolume';
  self.logger.info('ControllerBluetoothInput::output device changed to ' + newDevice);

  if (self.audioService) {
    self.audioService.setOutputDevice(newDevice);
  }
};

// --- Helpers ---

ControllerBluetoothInput.prototype._t = function (key) {
  var self = this;
  try {
    var langCode = self.commandRouter.sharedVars.get('language_code');
    var langFile = __dirname + '/i18n/strings_' + langCode + '.json';
    var defaultFile = __dirname + '/i18n/strings_en.json';
    var strings;

    if (fs.existsSync(langFile)) {
      strings = fs.readJsonSync(langFile);
    } else {
      strings = fs.readJsonSync(defaultFile);
    }
    return strings[key] || key;
  } catch (e) {
    return key;
  }
};
