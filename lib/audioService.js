'use strict';

var exec = require('child_process').exec;

function AudioService(logger) {
  this.logger = logger;
  this.outputDevice = 'softvolume';
  this.activeStreams = {};
}

AudioService.prototype.start = function (outputDevice) {
  var self = this;
  self.outputDevice = outputDevice || 'softvolume';
  return self._systemctl('start', 'bluealsa.service');
};

AudioService.prototype.stop = function () {
  var self = this;
  var macs = Object.keys(self.activeStreams);
  var chain = Promise.resolve();

  macs.forEach(function (mac) {
    chain = chain.then(function () {
      return self.stopAplay(mac);
    });
  });

  return chain.then(function () {
    return self._systemctl('stop', 'bluealsa.service');
  });
};

AudioService.prototype.startAplay = function (mac) {
  var self = this;
  var device = self.outputDevice;
  var serviceName = 'bluealsa-aplay@' + mac + '.service';

  return self._writeAplayOverride(mac, device)
    .then(function () {
      return self._execCmd('sudo systemctl daemon-reload');
    })
    .then(function () {
      return self._systemctl('start', serviceName);
    })
    .then(function () {
      self.activeStreams[mac] = { device: device };
      self.logger.info('AudioService::startAplay ' + mac + ' -> ' + device);
    })
    .catch(function (err) {
      self.logger.error('AudioService::startAplay failed for ' + mac + ': ' + err);
    });
};

AudioService.prototype.stopAplay = function (mac) {
  var self = this;
  var serviceName = 'bluealsa-aplay@' + mac + '.service';

  return self._systemctl('stop', serviceName)
    .then(function () {
      delete self.activeStreams[mac];
      self.logger.info('AudioService::stopAplay ' + mac);
    })
    .catch(function (err) {
      self.logger.error('AudioService::stopAplay failed for ' + mac + ': ' + err);
      delete self.activeStreams[mac];
    });
};

AudioService.prototype.setOutputDevice = function (device) {
  var self = this;
  self.outputDevice = device;
  var macs = Object.keys(self.activeStreams);

  if (macs.length === 0) {
    return Promise.resolve();
  }

  self.logger.info('AudioService::setOutputDevice -> ' + device + ', restarting ' + macs.length + ' stream(s)');

  var chain = Promise.resolve();
  macs.forEach(function (mac) {
    chain = chain.then(function () {
      return self.stopAplay(mac);
    }).then(function () {
      return self.startAplay(mac);
    });
  });
  return chain;
};

AudioService.prototype.getRunningStreams = function () {
  return Object.assign({}, this.activeStreams);
};

// Write a systemd override so the template unit uses the current output device
AudioService.prototype._writeAplayOverride = function (mac, device) {
  var self = this;
  var overrideDir = '/etc/systemd/system/bluealsa-aplay@' + mac + '.service.d';
  var overrideFile = overrideDir + '/output.conf';
  var content = '[Service]\nExecStart=\nExecStart=/usr/bin/bluealsa-aplay ' + mac + ' -D ' + device + '\n';

  var cmd = 'sudo mkdir -p "' + overrideDir + '" && echo \'' + content + '\' | sudo tee "' + overrideFile + '" > /dev/null';
  return self._execCmd(cmd);
};

AudioService.prototype._systemctl = function (action, service) {
  return this._execCmd('sudo systemctl ' + action + ' ' + service);
};

AudioService.prototype._execCmd = function (command) {
  var self = this;
  return new Promise(function (resolve, reject) {
    exec(command, { timeout: 30000 }, function (error, stdout, stderr) {
      if (error) {
        self.logger.error('AudioService::exec [' + command + '] error: ' + (stderr || error.message));
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
};

module.exports = AudioService;
