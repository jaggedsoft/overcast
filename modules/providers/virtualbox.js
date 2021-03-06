var fs = require('fs');
var AWS = require('aws-sdk');
var cp = require('child_process');
var Promise = require('bluebird');
var _ = require('lodash');
var rimraf = require('rimraf');
var utils = require('../utils');

var FIRST_IP = '192.168.22.10';
var OVERCAST_VAGRANT_DIR = utils.getUserHome() + '/.overcast-vagrant';

var BUNDLED_IMAGE_URLS = {
  'trusty64': 'https://cloud-images.ubuntu.com/vagrant/trusty/current/trusty-server-cloudimg-amd64-vagrant-disk1.box',
  'precise64': 'https://cloud-images.ubuntu.com/vagrant/precise/current/precise-server-cloudimg-amd64-vagrant-disk1.box'
};

exports.parseCSV = function (str) {
  var arr = [];
  _.each((str || '').split("\n"), function (row) {
    row = row.trim();
    if (row) {
      // TODO: This doesn't handle double quotes or escaped commas. Fix me.
      arr.push(row.split(','));
    }
  });
  return arr;
};

exports.getImages = function (args) {
  return new Promise(function (resolve, reject) {
    var vagrant = utils.spawn(['vagrant box list --machine-readable']);
    var stdout = '';

    vagrant.stdout.on('data', function (data) {
      stdout += data + '';
    });

    vagrant.on('exit', function (code) {
      if (code !== 0) {
        reject();
      } else {
        stdout = exports.parseCSV(stdout);
        var images = [];
        _.each(stdout, function (row) {
          if (row[2] === 'box-name') {
            images.push(row[3]);
          }
        });
        args.vagrantImages = images;
        resolve(args);
      }
    });
  });
};

exports.createBox = function (args) {
  return new Promise(function (resolve, reject) {
    if (args.vagrantImages && args.vagrantImages.indexOf(args.image) !== -1) {
      utils.grey('Image "' + args.image + '" found.');
      resolve(args);
    } else if (BUNDLED_IMAGE_URLS[args.image]) {
      var color = utils.SSH_COLORS[utils.SSH_COUNT++ % 5];
      var vagrant = utils.spawn(['vagrant box add --name ' + args.image + ' ' + BUNDLED_IMAGE_URLS[args.image]]);

      vagrant.stdout.on('data', function (data) {
        utils.prefixPrint(args.name, color, data);
      });

      vagrant.stderr.on('data', function (data) {
        utils.prefixPrint(args.name, color, data, 'grey');
      });

      vagrant.on('exit', function (code) {
        if (code !== 0) {
          reject();
        } else {
          resolve(args);
        }
      });
    } else {
      utils.red('Image "' + args.image + '" not found. Please add this using Vagrant:');
      utils.die('vagrant box add --name "' + args.image + '" [image-url]');
    }
  });
};

exports.nextAvailableIP = function (ip) {
  if (fs.existsSync(OVERCAST_VAGRANT_DIR + '/' + ip)) {
    var existing = fs.readdirSync(OVERCAST_VAGRANT_DIR);
    return exports.findNextAvailableIP(existing);
  } else {
    return ip;
  }
};

exports.findNextAvailableIP = function (existing) {
  var ip = FIRST_IP;

  while (existing.indexOf(ip) !== -1) {
    ip = ip.split('.');
    if (ip[3] === '255') {
      if (ip[2] === '255') {
        utils.red('Congratulations! You seem to have used all available IP addresses in the 192.168 block.');
        utils.die('Please destroy some of these instances before making a new one.');
      }
      ip[2] = parseInt(ip[2], 10) + 1;
      ip[3] = '10';
    } else {
      ip[3] = parseInt(ip[3], 10) + 1;
    }
    ip = ip.join('.');
  }

  return ip;
};

exports.createInstance = function (args) {
  return new Promise(function (resolve, reject) {
    var ip = exports.nextAvailableIP(args.ip || FIRST_IP);
    utils.grey('Using IP address ' + ip + '.');

    args.ip = ip;
    args.dir = OVERCAST_VAGRANT_DIR + '/' + ip;

    var color = utils.SSH_COLORS[utils.SSH_COUNT++ % 5];

    var bashArgs = [
      utils.escapeWindowsPath(__dirname + '/../../bin/vagrant')
    ];

    var bashEnv = _.extend({}, process.env, {
      VM_BOX: args.image,
      VM_IP: args.ip,
      VM_RAM: args.ram,
      VM_CPUS: args.cpus,
      VM_PUB_KEY: args.ssh_pub_key
    });

    var bash = cp.spawn('bash', bashArgs, { env: bashEnv });

    bash.stdout.on('data', function (data) {
      utils.prefixPrint(args.name, color, data);
    });

    bash.stderr.on('data', function (data) {
      utils.prefixPrint(args.name, color, data, 'grey');
    });

    bash.on('exit', function (code) {
      if (code !== 0) {
        reject();
      } else {
        resolve(args);
      }
    });
  });
};

exports.stopInstance = function (instance) {
  return new Promise(function (resolve, reject) {
    var color = utils.SSH_COLORS[utils.SSH_COUNT++ % 5];
    var vagrant = utils.spawn('vagrant halt', {
      cwd: instance.virtualbox.dir
    });

    vagrant.stdout.on('data', function (data) {
      utils.prefixPrint(instance.name, color, data);
    });

    vagrant.stderr.on('data', function (data) {
      utils.prefixPrint(instance.name, color, data, 'grey');
    });

    vagrant.on('exit', function (code) {
      if (code !== 0) {
        reject();
      } else {
        resolve(instance);
      }
    });
  });
};

exports.startInstance = function (instance) {
  return new Promise(function (resolve, reject) {
    var color = utils.SSH_COLORS[utils.SSH_COUNT++ % 5];
    var vagrant = utils.spawn('vagrant up', {
      cwd: instance.virtualbox.dir
    });

    vagrant.stdout.on('data', function (data) {
      utils.prefixPrint(instance.name, color, data);
    });

    vagrant.stderr.on('data', function (data) {
      utils.prefixPrint(instance.name, color, data, 'grey');
    });

    vagrant.on('exit', function (code) {
      if (code !== 0) {
        reject();
      } else {
        resolve(instance);
      }
    });
  });
};

exports.destroyInstance = function (instance) {
  return new Promise(function (resolve, reject) {
    var color = utils.SSH_COLORS[utils.SSH_COUNT++ % 5];
    var vagrant = utils.spawn('vagrant destroy -f', {
      cwd: instance.virtualbox.dir
    });

    vagrant.stdout.on('data', function (data) {
      utils.prefixPrint(instance.name, color, data);
    });

    vagrant.stderr.on('data', function (data) {
      utils.prefixPrint(instance.name, color, data, 'grey');
    });

    vagrant.on('exit', function (code) {
      if (code !== 0) {
        reject();
      } else {
        // cross-platform rm -rf
        rimraf(instance.virtualbox.dir, function () {
          resolve(instance);
        });
      }
    });
  });
};

exports.catch = function (err) {
  utils.die(err && err.message ? err.message : err);
};

exports.log = function (args) {
  console.log(JSON.stringify(args, null, 2));
};
