'use strict';

var EventEmitter = require('events');
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;

function BluetoothManager(logger) {
  this.logger = logger;
  this.emitter = new EventEmitter();
  this.scanning = false;
  this.monitorProcess = null;
  // Tracks devices physically connected at BT protocol level (independent of audio streaming)
  this.connectedDevices = {};
}

BluetoothManager.prototype.getConnectedDevices = function () {
  return Object.values(this.connectedDevices);
};

BluetoothManager.prototype.reconnectTrusted = function () {
  var self = this;
  return self.getPairedDevices()
    .then(function (devices) {
      if (devices.length === 0) return;
      self.logger.info('BluetoothManager::reconnectTrusted - attempting ' + devices.length + ' device(s)');
      var chain = Promise.resolve();
      devices.forEach(function (device) {
        chain = chain.then(function () {
          // Fire-and-forget: device may be out of range, that is fine
          return self._execBtctl('connect ' + device.mac).catch(function () {});
        });
      });
      return chain;
    })
    .catch(function (err) {
      self.logger.error('BluetoothManager::reconnectTrusted error: ' + err);
    });
};

BluetoothManager.prototype.on = function (event, handler) {
  this.emitter.on(event, handler);
};

BluetoothManager.prototype.removeAllListeners = function () {
  this.emitter.removeAllListeners();
};

BluetoothManager.prototype.initialize = function (deviceName, discoverable) {
  var self = this;
  return self._execBtctl('power on')
    .then(function () {
      return self.setAlias(deviceName || 'Volumio');
    })
    .then(function () {
      return self.setDiscoverable(discoverable !== false);
    })
    .then(function () {
      return self._startMonitor();
    });
};

BluetoothManager.prototype.shutdown = function () {
  var self = this;
  self._stopMonitor();
  return self.setDiscoverable(false)
    .then(function () {
      return self._execBtctl('power off');
    });
};

BluetoothManager.prototype.setDiscoverable = function (enabled) {
  var self = this;
  var cmd = enabled ? 'discoverable on' : 'discoverable off';
  return self._execBtctl(cmd).then(function () {
    if (enabled) {
      return self._execBtctl('pairable on');
    }
  });
};

BluetoothManager.prototype.setAlias = function (name) {
  return this._execBtctl('system-alias ' + name);
};

BluetoothManager.prototype.startScan = function (duration) {
  var self = this;
  duration = duration || 10000;

  if (self.scanning) {
    return Promise.resolve([]);
  }

  self.scanning = true;
  return self._execBtctl('scan on')
    .then(function () {
      return new Promise(function (resolve) {
        setTimeout(function () {
          self._execBtctl('scan off')
            .then(function () {
              self.scanning = false;
              return self.getDiscoveredDevices();
            })
            .then(resolve)
            .catch(function () {
              self.scanning = false;
              resolve([]);
            });
        }, duration);
      });
    })
    .catch(function (err) {
      self.scanning = false;
      self.logger.error('BluetoothManager::startScan failed: ' + err);
      return [];
    });
};

BluetoothManager.prototype.stopScan = function () {
  var self = this;
  self.scanning = false;
  return self._execBtctl('scan off');
};

BluetoothManager.prototype.getDiscoveredDevices = function () {
  return this._execCmd('bluetoothctl devices')
    .then(function (stdout) {
      return parseDeviceList(stdout);
    })
    .catch(function () {
      return [];
    });
};

BluetoothManager.prototype.getPairedDevices = function () {
  return this._execCmd('bluetoothctl paired-devices')
    .then(function (stdout) {
      return parseDeviceList(stdout);
    })
    .catch(function () {
      return [];
    });
};

BluetoothManager.prototype.pairDevice = function (mac) {
  var self = this;
  return self._execBtctl('pair ' + mac)
    .then(function () {
      return self._execBtctl('trust ' + mac);
    });
};

BluetoothManager.prototype.removeDevice = function (mac) {
  return this._execBtctl('remove ' + mac);
};

BluetoothManager.prototype.isAdapterPresent = function () {
  return this._execCmd('bluetoothctl show')
    .then(function (stdout) {
      return stdout.indexOf('Controller') !== -1;
    })
    .catch(function () {
      return false;
    });
};

// --- Private ---

BluetoothManager.prototype._execBtctl = function (command) {
  var self = this;
  var fullCmd = 'echo "' + command + '" | bluetoothctl';
  return new Promise(function (resolve, reject) {
    exec(fullCmd, { timeout: 15000 }, function (error, stdout, stderr) {
      if (error && stdout.indexOf('Changing') === -1 && stdout.indexOf('succeeded') === -1) {
        self.logger.error('BluetoothManager::btctl [' + command + '] error: ' + (stderr || error.message));
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
};

BluetoothManager.prototype._execCmd = function (command) {
  var self = this;
  return new Promise(function (resolve, reject) {
    exec(command, { timeout: 10000 }, function (error, stdout, stderr) {
      if (error) {
        self.logger.error('BluetoothManager::exec [' + command + '] error: ' + (stderr || error.message));
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
};

BluetoothManager.prototype._startMonitor = function () {
  var self = this;
  self._stopMonitor();

  try {
    self.monitorProcess = spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'pipe'] });

    // Register as NoInputNoOutput agent on this persistent process.
    // This is what makes "Just Works" pairing happen (no PIN prompt).
    // The agent only lives as long as the process does, so it must be
    // the long-running monitor -- not an ephemeral echo-pipe session.
    setTimeout(function () {
      self._writeMonitor('agent NoInputNoOutput');
      setTimeout(function () {
        self._writeMonitor('default-agent');
      }, 500);
    }, 500);

    var buffer = '';
    self.monitorProcess.stdout.on('data', function (data) {
      buffer += data.toString();
      var lines = buffer.split('\n');
      buffer = lines.pop();

      lines.forEach(function (line) {
        self._parseMonitorLine(line);
      });
    });

    self.monitorProcess.on('error', function (err) {
      self.logger.error('BluetoothManager::monitor process error: ' + err.message);
    });

    self.monitorProcess.on('close', function (code) {
      self.logger.info('BluetoothManager::monitor process closed (code ' + code + ')');
      self.monitorProcess = null;
    });
  } catch (err) {
    self.logger.error('BluetoothManager::_startMonitor failed: ' + err.message);
  }
};

BluetoothManager.prototype._writeMonitor = function (command) {
  if (this.monitorProcess && this.monitorProcess.stdin && !this.monitorProcess.stdin.destroyed) {
    this.monitorProcess.stdin.write(command + '\n');
  }
};

BluetoothManager.prototype._stopMonitor = function () {
  if (this.monitorProcess) {
    try {
      this.monitorProcess.kill();
    } catch (e) { /* ignore */ }
    this.monitorProcess = null;
  }
};

BluetoothManager.prototype._parseMonitorLine = function (line) {
  var self = this;
  var cleanLine = line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim();

  // Auto-accept all pairing and service authorization prompts.
  // With NoInputNoOutput capability, most of these shouldn't appear,
  // but some BlueZ versions or iOS handshakes can still trigger them.
  if (cleanLine.match(/Confirm passkey/i) ||
      cleanLine.match(/Authorize service/i) ||
      cleanLine.match(/Request confirmation/i) ||
      cleanLine.match(/Accept pairing/i) ||
      cleanLine.match(/\(yes\/no\)/i)) {
    self.logger.info('BluetoothManager::auto-accepting: ' + cleanLine);
    self._writeMonitor('yes');
    return;
  }

  // Auto-trust newly paired devices so reconnection works without prompts
  var pairedMatch = cleanLine.match(/\[NEW\] Device ([0-9A-F:]{17})/i) ||
                    cleanLine.match(/Pairing successful.*([0-9A-F:]{17})/i);
  if (pairedMatch) {
    var pairedMac = pairedMatch[1];
    self.logger.info('BluetoothManager::auto-trusting new device: ' + pairedMac);
    self._writeMonitor('trust ' + pairedMac);
  }

  var connectMatch = cleanLine.match(/\[CHG\] Device ([0-9A-F:]{17}) Connected: yes/i);
  if (connectMatch) {
    var mac = connectMatch[1];
    self.logger.info('BluetoothManager::device connected: ' + mac);
    self._getDeviceName(mac).then(function (name) {
      self.connectedDevices[mac] = { mac: mac, name: name };
      self.emitter.emit('deviceConnected', { mac: mac, name: name });
    });
    return;
  }

  var disconnectMatch = cleanLine.match(/\[CHG\] Device ([0-9A-F:]{17}) Connected: no/i);
  if (disconnectMatch) {
    var macDisc = disconnectMatch[1];
    self.logger.info('BluetoothManager::device disconnected: ' + macDisc);
    delete self.connectedDevices[macDisc];
    self.emitter.emit('deviceDisconnected', { mac: macDisc });
    return;
  }
};

BluetoothManager.prototype._getDeviceName = function (mac) {
  return this._execCmd('bluetoothctl info ' + mac)
    .then(function (stdout) {
      var nameMatch = stdout.match(/Name:\s*(.+)/);
      return nameMatch ? nameMatch[1].trim() : mac;
    })
    .catch(function () {
      return mac;
    });
};

// --- Helpers ---

function parseDeviceList(stdout) {
  var devices = [];
  var lines = stdout.split('\n');
  lines.forEach(function (line) {
    var match = line.match(/Device\s+([0-9A-F:]{17})\s+(.+)/i);
    if (match) {
      devices.push({ mac: match[1], name: match[2].trim() });
    }
  });
  return devices;
}

module.exports = BluetoothManager;
