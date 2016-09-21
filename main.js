const electron = require('electron')
const app = electron.app // Module to control application life.
process.env.directory = process.env.directory || app.getAppPath()
const BrowserWindow = electron.BrowserWindow // Module to create native browser window.
const ipc = electron.ipcMain
const dialog = electron.dialog
const Menu = electron.Menu

require('./server')
var settings = require('./helpers/settings')
var ServerEvents = require('./helpers/server-events')
ServerEvents.on('cl_upload_progress', function(done, bytes) {
  if (done)
    mainWindow.send('cl_upload_progress', { status: 'waiting' });
  else {
    var value = bytes, units = 'B';
    if (bytes < 1024) {
      //Do nothing
    } else if (bytes < (1024 * 1024)) {
      value = bytes / 1024;
      units = 'KB';
    } else {
      value = bytes / (1024 * 1024);
      units = 'MB';
    }
    value = +value.toFixed(2);
    mainWindow.send('cl_upload_progress', { status: 'uploading', progress: value + ' ' + units });
  }
});

var http = require('http')
var fs = require('fs-extra')
var readline = require('readline')
var path = require('path')
var unzip = require('unzip2');
var GeoJson = require('./helpers/rebuild-geojson')
var async = require('async');
var i18n = require('./helpers/locale.js');

ipc.on('show_configuration', function (event, arg) {
  try {
    var _defaults = settings.defaults
    var _results = {
      'directory': settings.getDataDirectory() || _defaults.data_directory,
      'station': settings.getStation() || _defaults.station,
      'baseUrl': settings.getBaseUrl(),
      'shared_secret': settings.getSharedSecret(),
      'locale': settings.getLocale() || _defaults.locale,
      'community_lands': !(settings.getCommunityLandsServer() === undefined || settings.getCommunityLandsToken() === undefined)
    }
    console.log(_results)
    event.sender.send('has_configuration', _results)
  } catch (err) {
    event.sender.send('has_configuration', [])
  }
})

ipc.on('backup_submissions', function (event, arg) {
  var options = {
    hostname: 'localhost',
    port: settings.getPort() || 3000,
    path: '/save/all',
    method: 'GET'
  }
  http.request(options, function (res) {
    var data = ''
    res.on('data', function (chunk) {
      data += chunk
    })
    res.on('end', function () {
      result = JSON.parse(data);
      result['cb'] = arg;
      result['cancelled'] = false;
      if (arg) {
        options = {
          defaultPath: result.location
        }
        dialog.showSaveDialog(mainWindow, options, function(filename) {
          if (filename && result.location != filename) {
            fs.copy(result.location, filename, function(err) {
              if (err) {
                result['error'] = true;
                result['code'] = 'backup_failed';
              } else {
                result.location = filename;
              }
              event.sender.send('backup_submissions_complete', result);
            });
          } else {
            result['cancelled'] = result.location == filename;
            event.sender.send('backup_submissions_complete', result);
          }
        });
      } else {
        event.sender.send('backup_submissions_complete', result)
      }
    })
  }).on('error', function (e) {
    event.sender.send('backup_submissions_complete',{"error":true, "code":"could_not_connect", "message":"Could not connect to server"})
  }).end()
})

ipc.on('check_last_backup', function (event, arg) {
  var options = {
    hostname: 'localhost',
    port: settings.getPort() || 3000,
    path: '/save/status',
    method: 'GET'
  }
  http.request(options, function (res) {
    var data = ''
    res.on('data', function (chunk) {
      data += chunk
    })
    res.on('end', function () {
      event.sender.send('has_last_backup', data)
    })
  }).end()
})

ipc.on('form_delete', function (event, arg) {
  var folder = settings.getUserFormsDirectory()
  fs.readdir(folder, function (err, files) {
    if (err) {
      event.sender.send('has_form_delete')
    } else {
      var found = false
      for (var i in files) {
        if (files[i] === arg) {
          fs.unlinkSync(path.join(folder, files[i]))
          event.sender.send('has_form_delete')
          found = true
          break
        }
      }
      if (!found)
        event.sender.send('has_form_delete')
    }
  })
})

/*
 * Cheating a bit here -- instead of reading the entire file and parsing the 
 * XML, going to read line-by-line instead until I find the interesting line, 
 * then break early if possible.
 */
function createFormReader(key) {
  return function(cb) {
    var reader = readline.createInterface({
      input: fs.createReadStream(path.join(settings.getUserFormsDirectory(), key)),
      terminal: true
    });
    var item = { file: key, name: key };
    reader.on('line', function (input) {
      var line = input.trim();
      if (line.startsWith("<h:title")) {
        item.name = line.substring("<h:title>".length, line.indexOf("</h:title>"));
        /*
         * FIXME: Hack to close the input stream early and stop reading extra 
         * information. Would like a better solution. For now, simulate terminal 
         * input of Ctrl+C/D
         */
        reader.write(null, { ctrl: true, name: require('os').platform() == 'win32' ? 'd' : 'c' })
      }
    });
    reader.on('close', function () {
      cb(null, item);
    });
  }
}

ipc.on('form_list', function (event, arg) {
  var folder = settings.getUserFormsDirectory();
  fs.readdir(folder, function (err, files) {
    var data = { forms: [] }
    if (err) {
      event.sender.send('has_form_list', data)
    } else {
      var parallels = files.map(createFormReader);
      async.parallel(parallels, function(a_err, results) {
        var data = { forms: [] }
        if (!a_err) {
          for (var key in results)
            data.forms.push(results[key])
          data.forms.sort(function(a, b) {
            var l = a.name.toLowerCase();
            var r = b.name.toLowerCase();
            return l < r ? -1 : l > r ? 1 : 0;
          });
        }
        event.sender.send('has_form_list', data);
      });
    }
  })
})

ipc.on('select_data_directory', function (event, arg) {
  var options = {
    properties: ['openDirectory'],
    defaultPath: settings.getDataDirectory()
  }
  dialog.showOpenDialog(mainWindow, options, function (folder) {
    if (folder) {
      event.sender.send('has_select_data_directory', folder)
    }
  })
})

ipc.on('select_form', function (event, arg) {
  var options = {
    properties: ['openFile', 'multiSelections'],
    filters: [ { name: 'XML', extensions: ['xml'] } ]
  }
  dialog.showOpenDialog(mainWindow, options, function (arr) {
    if (arr !== undefined) {
      var destDir = settings.getUserFormsDirectory()
      var uploaded = {
        count: arr.length,
        names: []
      }
      for (var index in arr) {
        var source = arr[index]
        var filename = path.basename(source)
        var target = path.join(destDir, filename)
        fs.copySync(source, target)
        uploaded.names.push(filename)
      }
      event.sender.send('has_select_form', uploaded)
    }
  })
})

ipc.on('filter_list', function (event, arg) {
  var options = {
    hostname: 'localhost',
    port: settings.getPort() || 3000,
    path: '/mapfilter/filters',
    method: 'GET'
  }
  http.request(options, function (res) {
    var data = ''
    res.on('data', function (chunk) {
      data += chunk
    })
    res.on('end', function () {
      event.sender.send('has_filter_list', data)
    })
  }).on('error', function (e) {
    event.sender.send('has_filter_list', '{"error":true, "code":"could_not_connect", "message":"Could not connect to server"}')
  }).end()
})

ipc.on('filter_delete', function (event, arg) {
  var options = {
    hostname: 'localhost',
    port: settings.getPort() || 3000,
    path: '/mapfilter/filters/local/' + arg,
    method: 'DELETE'
  }
  http.request(options, function (res) {
    var data = ''
    res.on('data', function (chunk) {
      data += chunk
    })
    res.on('end', function() {
      event.sender.send('filter_list_changed', data);
    })
  }).on('error', function (e) {
    event.sender.send('filter_list_changed');
  }).end()
})

ipc.on('settings_list', function (event, arg) {
  settings.get(function(err, selected) {
    if (err) {
      event.sender.send('has_settings_list', settings.defaults)
    } else {
      var defaults = settings.defaults
      for (var key in selected)
        defaults[key] = selected[key]
      event.sender.send('has_settings_list', defaults)
    }
  })
})

ipc.on('settings_save', function (event, arg) {
  settings.save(arg, function (err) {
    if (err) {
      event.sender.send('has_settings_save', '{"error",true, "code":"could_not_save_settings", "message":"Could not save settings file"}')
    } else {
      event.sender.send('has_settings_save', '{"error":false}')
    }
  })
})

ipc.on('list_map_layers', function (event, arg) {
  fs.readdir(settings.getTilesDirectory(), function(err, files) {
    if (err)
      event.sender.send('has_list_map_layers', [])
    else {
      var arr = []
      for (var i = 0; i < files.length; i++)
        arr.push({name: files[i], value: files[i]});
      event.sender.send('has_list_map_layers', arr);
    }
  });
});

ipc.on('import_files', function(event, args) {
  var options = {
    properties: ['openFile'],
    filters: [ { name: 'ZIP', extensions: ['zip'] } ]
  };

  dialog.showOpenDialog(mainWindow, options, function(file) {
    if (file) {
      var source = '' + file;
      var target = path.dirname(settings.getSubmissionsDirectory());

      var complete = function(err) {
        if (err) {
          event.sender.send('has_import_files', { error: true, code: 'import_delete_failed', ex: err });
        } else {
          try {
            fs.createReadStream(source)
            .pipe(unzip.Extract({ path: target }))
            .on('close', function() {
              GeoJson.generate(function(err_json, details) {
                if (err_json)
                  event.sender.send('has_import_files', err_json);
                else
                  event.sender.send('has_import_files', { error: false, details: details });
              });
            });
          } catch (e) {
            console.log(e);
            event.sender.send('has_import_files', { error: true, code: 'import_unzip_failed', ex: e });
          }
        }
      };

      if (args.mode == 'merge')
        complete(null);
      else
        fs.emptydir(path.join(target, 'Submissions'), complete);
    } else {
      event.sender.send('has_import_files', { error: true, code: 'import_cancelled' });
    }
  });
});

ipc.on('community_lands_backup', function(event, arg) {
  if (settings.getCommunityLandsServer()) {
    var options = {
      hostname: 'localhost',
      port: settings.getPort() || 3000,
      path: '/backup/latest',
      method: 'GET'
    }
    http.request(options, function (res) {
      var data = ''
      res.on('data', function (chunk) {
        data += chunk
      })
      res.on('end', function () {
        event.sender.send('has_community_lands_backup', data)
      })
    }).on('error', function (e) {
      event.sender.send('has_community_lands_backup', '{"error":true, "code":"could_not_connect", "message":"Could not connect to server"}')
    }).end()
  } else {
    event.sender.send('has_community_lands_backup', '{"error":true, "code":"community_lands_not_configured", "message":"Community Lands connection not configured"}')
  }
})

ipc.on('community_lands_status', function (event, arg) {
  if (settings.getCommunityLandsServer()) {
    var options = {
      hostname: 'localhost',
      port: settings.getPort() || 3000,
      path: '/backup/status',
      method: 'GET'
    }
    http.request(options, function (res) {
      var data = ''
      res.on('data', function (chunk) {
        data += chunk
      })
      res.on('end', function () {
        event.sender.send('has_community_lands_status', data)
      })
    }).on('error', function (e) {
      event.sender.send('has_community_lands_status', null)
    }).end()
  } else {
    event.sender.send('has_community_lands_status', null)
  }
})

ipc.on('community_lands_online', function (event, arg) {
  event.sender.send('has_community_lands_online', arg)
})

var FiltersDir = settings.getFiltersDirectory()
try {
  fs.mkdirpSync(FiltersDir)
} catch (e) { // It's ok
}
try {
  fs.watch(FiltersDir, function (evt, filename) {
    mainWindow.send('filter_list_changed');
  })
} catch (e) { // It's ok
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
var mainWindow = null

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  app.quit()
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', function () {
  // Create the browser window.
  mainWindow = new BrowserWindow({minWidth: 400, minHeight: 400})

  // and load the index.html of the app.
  mainWindow.loadURL('file://' + __dirname + '/index.html?locale=' + (settings.getLocale() || 'en'))

  // Open the DevTools.
  // mainWindow.openDevTools()

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null
  })

  // Create the Application's main menu
  var template = [{
    label: i18n.t('menu.application'),
    submenu: [
        { label: i18n.t('menu.about'), selector: "orderFrontStandardAboutPanel:" },
        { type: "separator" },
        { label: i18n.t('menu.quit'), accelerator: "Command+Q", click: function() { app.quit(); }}
    ]}, {
    label: i18n.t('menu.edit'),
    submenu: [
        { label: i18n.t('menu.undo'), accelerator: "CmdOrCtrl+Z", selector: "undo:" },
        { label: i18n.t('menu.redo'), accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
        { type: "separator" },
        { label: i18n.t('menu.cut'), accelerator: "CmdOrCtrl+X", selector: "cut:" },
        { label: i18n.t('menu.copy'), accelerator: "CmdOrCtrl+C", selector: "copy:" },
        { label: i18n.t('menu.paste'), accelerator: "CmdOrCtrl+V", selector: "paste:" },
        { label: i18n.t('menu.select_all'), accelerator: "CmdOrCtrl+A", selector: "selectAll:" }
    ]}
  ];
  if (settings.isDevMode()) {
    template.push({
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click (item, focusedWindow) {
            if (focusedWindow) focusedWindow.reload()
          }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click (item, focusedWindow) {
            if (focusedWindow) focusedWindow.webContents.toggleDevTools()
          }
        },
        {
          type: 'separator'
        },
        {
          role: 'togglefullscreen'
        }
      ]
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
})
