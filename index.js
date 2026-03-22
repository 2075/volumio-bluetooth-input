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
  var latencyMode = self.config.get('latencyMode') || 'low';
  var outputDevice = self._resolveAlsaDevice(
    self.commandRouter.sharedVars.get('alsa.outputdevice')
  );

  self.btManager.isAdapterPresent()
    .then(function (present) {
      if (!present) {
        self.commandRouter.pushToastMessage('error', 'Bluetooth Audio Input', self._t('NO_BT_ADAPTER'));
        defer.reject(new Error('No Bluetooth adapter'));
        return;
      }

      return self.btManager.initialize(deviceName, discoverable)
        .then(function () {
          return self.audioService.start(outputDevice, latencyMode);
        })
        .then(function () {
          return self._startAgentService();
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

  chain = chain.then(function () {
    return self._stopAgentService();
  });

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

      var currentLatency = self.config.get('latencyMode') || 'low';
      var latencyOptions = uiconf.sections[0].content[3].options;
      for (var i = 0; i < latencyOptions.length; i++) {
        if (latencyOptions[i].value === currentLatency) {
          uiconf.sections[0].content[3].value = latencyOptions[i];
          break;
        }
      }

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
  if (data.latencyMode !== undefined) {
    var latVal = data.latencyMode.value || data.latencyMode;
    self.config.set('latencyMode', latVal);
    if (self.audioService) {
      self.audioService.setLatencyMode(latVal);
    }
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

      self._enterVolatileMode(device);

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

      var streams = self.audioService ? self.audioService.getRunningStreams() : {};
      if (Object.keys(streams).length === 0) {
        self._exitVolatileMode();
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
  var raw = self.commandRouter.sharedVars.get('alsa.outputdevice');
  var resolved = self._resolveAlsaDevice(raw);
  self.logger.info('ControllerBluetoothInput::output device changed: ' + raw + ' -> ' + resolved);

  if (self.audioService) {
    self.audioService.setOutputDevice(resolved);
  }
};

ControllerBluetoothInput.prototype._resolveAlsaDevice = function (value) {
  if (!value && value !== 0) {
    return 'plughw:0,0';
  }
  var str = String(value).trim();
  // Already a full ALSA device name (e.g. "hw:1,0", "plughw:2,0", "softvolume")
  if (str.indexOf(':') !== -1) {
    return str;
  }
  // Pure number = Volumio card index, wrap in plughw for format conversion
  if (/^\d+$/.test(str)) {
    return 'plughw:' + str + ',0';
  }
  // Named device like "softvolume" -- try it as-is, but it may not work
  // with bluealsa-aplay; log a warning
  this.logger.info('ControllerBluetoothInput::using named ALSA device: ' + str);
  return str;
};

// --- Volatile mode (take over Volumio's audio output) ---

ControllerBluetoothInput.prototype._enterVolatileMode = function (device) {
  var self = this;

  // Stop current Volumio playback so MPD releases the ALSA device
  self.commandRouter.volumioStop();

  // Tell Volumio we're taking over — puts the UI in "volatile" mode
  self.commandRouter.stateMachine.setVolatile({
    service: 'bluetooth_input',
    callback: self._onVolatileStopped.bind(self)
  });

  // Push a state so the Volumio UI shows the BT source
  self.commandRouter.stateMachine.syncState({
    status: 'play',
    service: 'bluetooth_input',
    title: device.name || 'Bluetooth',
    artist: '',
    album: 'Bluetooth Audio',
    albumart: '/albumart?sourceicon=music_service/bluetooth_input/bt.svg',
    uri: '',
    trackType: 'bluetooth',
    seek: 0,
    duration: 0,
    samplerate: '',
    bitdepth: '',
    channels: '',
    random: false,
    repeat: false,
    repeatSingle: false,
    disableUiControls: true
  }, 'bluetooth_input');
};

ControllerBluetoothInput.prototype._exitVolatileMode = function () {
  var self = this;
  try {
    self.commandRouter.stateMachine.unSetVolatile();
  } catch (e) {
    self.logger.error('ControllerBluetoothInput::_exitVolatileMode error: ' + e);
  }
};

ControllerBluetoothInput.prototype._onVolatileStopped = function () {
  var self = this;
  self.logger.info('ControllerBluetoothInput::volatile stop requested');

  // Volumio wants to resume normal playback — stop all BT audio streams
  if (self.audioService) {
    var streams = self.audioService.getRunningStreams();
    var macs = Object.keys(streams);
    macs.forEach(function (mac) {
      self.audioService.stopAplay(mac);
    });
  }
};

// --- Agent service ---

ControllerBluetoothInput.prototype._startAgentService = function () {
  var self = this;
  var exec = require('child_process').exec;
  return new Promise(function (resolve) {
    exec('sudo systemctl restart bt-agent.service', { timeout: 10000 }, function (error) {
      if (error) {
        self.logger.error('ControllerBluetoothInput::bt-agent start failed: ' + error);
      }
      resolve();
    });
  });
};

ControllerBluetoothInput.prototype._stopAgentService = function () {
  var self = this;
  var exec = require('child_process').exec;
  return new Promise(function (resolve) {
    exec('sudo systemctl stop bt-agent.service', { timeout: 10000 }, function (error) {
      if (error) {
        self.logger.error('ControllerBluetoothInput::bt-agent stop failed: ' + error);
      }
      resolve();
    });
  });
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
