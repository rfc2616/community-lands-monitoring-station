var app = require('app');  // Module to control application life.
process.env.directory = process.env.directory || app.getAppPath()
var BrowserWindow = require('browser-window');  // Module to create native browser window.

var http = require('http');
var fs = require('fs-extra');
var path = require('path');
var ipc = require('ipc');
var dialog = require('dialog');
var server = require('./server');
var dotenv = require('dotenv');

ipc.on('show_configuration', function(event, arg) {
  try{
    _defaults = getDefaultSettings()
    _results = {
      'directory': process.env.data_directory || _defaults.data_directory,
      'station': process.env.station || _defaults.station,
      'baseUrl': process.env.baseUrl,
      'shared_secret': process.env.shared_secret,
      'locale': process.env.locale || _defaults.locale,
      'community_lands': !(process.env.community_lands_server === undefined || process.env.community_lands_token === undefined)
    };
    console.log(_results);
    event.sender.send('has_configuration', _results);
  } catch (err) {
    event.sender.send('has_configuration', []);
  }
});

ipc.on('backup_submissions', function(event, arg) {
  var options = {
    hostname: 'localhost',
    port: process.env.port || 3000,
    path: '/save/all',
    method: 'GET'
  };
  var req = http.request(options, function(res) {
    var data = "";
    res.on('data', function(chunk) {
      data += chunk;
    });
    res.on('end', function() {
      event.sender.send('backup_submissions_complete', data);
    });
  }).on('error', function(e) {
    event.sender.send('backup_submissions_complete', '{"error":true, "code":"could_not_connect", "message":"Could not connect to server"}');
  }).end();
});

ipc.on('check_last_backup', function(event, arg) {
  var options = {
    hostname: 'localhost',
    port: process.env.port || 3000,
    path: '/save/status',
    method: 'GET'
  };
  var req = http.request(options, function(res) {
    var data = ""
    res.on('data', function(chunk) {
      data += chunk;
    });
    res.on('end', function() {
      event.sender.send('has_last_backup', data);
    });
  }).end();
});

ipc.on('form_delete', function(event, arg) {
  var folder = path.join(process.env.data_directory, 'Monitoring', process.env.station, 'Forms');
  fs.readdir(folder, function(err, files) {
    if (err) {
      event.sender.send('has_form_delete');
    } else {
      for (var i in files) {
        if (files[i] == arg) {
          fs.unlinkSync(path.join(folder, files[i]));
          event.sender.send('has_form_delete');
          break;
        }
      }
    }
  });
});

ipc.on('form_list', function(event, arg) {
  var folder = path.join(process.env.data_directory, 'Monitoring', process.env.station, 'Forms');
  fs.readdir(folder, function(err, files) {
    var data = { forms: [] };
    if (err)
      event.sender.send('has_form_list', data);
    else {
      data.forms = files;
      event.sender.send('has_form_list', data);
    }
  });
});

ipc.on('select_data_directory', function(event, arg) {
  var options = {
    properties: ['openDirectory'],
    defaultPath: process.env.data_directory
  };
  dialog.showOpenDialog(mainWindow, options, function(folder) {
    if (folder) {
      event.sender.send('has_select_data_directory', folder);
    }
  });
});

ipc.on('select_form', function(event, arg) {
  var options = {
    properties: ['openFile', 'multiSelections'],
    filters: [ { name: 'XML', extensions: ['xml'] } ]
  };
  dialog.showOpenDialog(mainWindow, options, function(arr) {
    if (arr !== undefined) {
      var destDir = path.join(process.env.data_directory, 'Monitoring', process.env.station, 'Forms');
      var uploaded = {
        count: arr.length,
        names: []
      };
      for (var index in arr) {
        var source = arr[index];
        var filename = path.basename(source);
        var target = path.join(destDir, filename);
        fs.copySync(source, target);
        uploaded.names.push(filename);
      }
      event.sender.send('has_select_form', uploaded);
    }
  });
});

ipc.on('filter_list', function(event, arg) {
  var options = {
    hostname: 'localhost',
    port: process.env.port || 3000,
    path: '/mapfilter/filters',
    method: 'GET'
  };
  var req = http.request(options, function(res) {
    var data = "";
    res.on('data', function(chunk) {
      data += chunk;
    });
    res.on('end', function() {
      event.sender.send('has_filter_list', data);
    });
  }).on('error', function(e) {
    event.sender.send('has_filter_list', '{"error":true, "code":"could_not_connect", "message":"Could not connect to server"}');
  }).end();
});

ipc.on('settings_list', function(event, arg) {
  fs.readFile(path.join(__dirname, '.env'), 'utf8', function(err, data) {
    if (err) {
      event.sender.send('has_settings_list', getDefaultSettings());
    } else {
      var defaults = getDefaultSettings();
      var selected = dotenv.parse(data);
      for (var key in selected)
        defaults[key] = selected[key];
      event.sender.send('has_settings_list', defaults);
    }
  });
});

ipc.on('settings_save', function(event, arg) {
  var properties = "";
  for (var key in arg) {
    if (arg[key]) {
      properties += key + '=' + arg[key];
      properties += "\r\n"
    }
  }
  fs.writeFile(path.join(__dirname, '.env'), properties, 'utf8', function(err) {
    if (err)
      event.sender.send('has_settings_save', '{"error",true, "code":"could_not_save_settings", "message":"Could not save settings file"}');
    else
      event.sender.send('has_settings_save', '{"error":false}');
  });
});

ipc.on('community_lands_backup', function(event, arg) {
  if (process.env.community_lands_server) {
    var options = {
      hostname: 'localhost',
      port: process.env.port || 3000,
      path: '/backup/latest',
      method: 'GET'
    };
    var req = http.request(options, function(res) {
      var data = "";
      res.on('data', function(chunk) {
        data += chunk;
      });
      res.on('end', function() {
        event.sender.send('has_community_lands_backup', data);
      });
    }).on('error', function(e) {
      event.sender.send('has_community_lands_backup', '{"error":true, "code":"could_not_connect", "message":"Could not connect to server"}');
    }).end();
  } else {
    event.sender.send('has_community_lands_backup', '{"error":true, "code":"community_lands_not_configured", "message":"Community Lands connection not configured"}');
  }
});

ipc.on('community_lands_status', function(event, arg) {
  if (process.env.community_lands_server) {
    var options = {
      hostname: 'localhost',
      port: process.env.port || 3000,
      path: '/backup/status',
      method: 'GET',
    };
    var req = http.request(options, function(res) {
      var data = "";
      res.on('data', function(chunk) {
        data += chunk;
      });
      res.on('end', function() {
        event.sender.send('has_community_lands_status', data);
      });
    }).on('error', function(e) {
      event.sender.send('has_community_lands_status', null);
    }).end();
  } else {
    event.sender.send('has_community_lands_status', null);
  }
});

ipc.on('community_lands_online', function(event, arg) {
  event.sender.send('has_community_lands_online', arg);
});

var FiltersDir = path.join(process.env.data_directory, 'Monitoring', process.env.station, 'Filters');
try {
  fs.mkdirpSync(FiltersDir);
} catch (e) { //It's ok
}
fs.watch(FiltersDir, function(evt, filename) {
  mainWindow.reload();
});

var getDefaultSettings = function() {
  return {
    data_directory: path.join(__dirname),
    station: 'DEMO',
    locale: 'en',
    community_lands_server: 'www.communitylands.org',
    community_lands_port: 80,
    community_lands_token: null,
    port: 3000,
    shared_secret: 'demo',
    mapZoom: null,
    mapCenterLat: null,
    mapCenterLong: null
  };
};

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
var mainWindow = null;

// Quit when all windows are closed.
app.on('window-all-closed', function() {
  app.quit();
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', function() {
  // Create the browser window.
  mainWindow = new BrowserWindow({width: 400, height: 400});

  // and load the index.html of the app.
  mainWindow.loadUrl('file://' + __dirname + '/index.html?locale=' + (process.env.locale || 'en'));

  // Open the DevTools.
  // mainWindow.openDevTools();

  // Emitted when the window is closed.
  mainWindow.on('closed', function() {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });
});
