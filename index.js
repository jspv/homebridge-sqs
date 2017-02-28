// Load moment-timezone for handling of the timezone offset properly
var moment = require('moment-timezone');
// setup access to the queue

// uncomment below to use debug version of sqs-worker
SQSWorker = require('./lib/jspsqs-worker');
// var SQSWorker = require('sqs-worker');
var Service, Characteristic, HomebridgeAPI;

// Number of seconds before resetetting motion sensors
// time is in seconds
const DEFAULT_NO_MOTION_TIME = 60,
      DEFAULT_MAX_EVENT_DELAY = 90;

module.exports = function(homebridge) {
    console.log("homebridge API version: " + homebridge.version);

    // Accessory must be created from PlatformAccessory Constructor
    Accessory = homebridge.platformAccessory;

    // Service and Characteristic are from hap-nodejs
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    HomebridgeAPI = homebridge;

    // 1st argument: Module original name ("homebridge-xy")
    // 2nd argument: Module name ("xy")
    // 3rd argument: Module function name ("Xy")
    // homebridge.registerAccessory("homebridge-sqs", "sqs-sensor", SensorAccessory);
    homebridge.registerPlatform("homebridge-sqs", "AWSSQSPlatform", AWSSQSPlatformInit, true);
};

// Platform constructor
// config may be null
// api may be null if launched from old homebridge version
function AWSSQSPlatformInit(log, config, api) {
    log(config.name, "Init: start");
    var platform = this;
    this.log = log;
    this.name = config.name;
    this.config = config;
    this.accessories = [];

    // Before homebridge sends out event didFinishLaunching, it will invoke
    // configureAccessory method on the plugin instance with the cached plugin, you
    // should configure the given accessories and save it somewhere so you you this
    // accessory already exists in homebridge and there is no need to add again.
    if (api) {
        this.api = api;
        // Listen to event "didFinishLaunching", this means homebridge already
        // finished loading cached accessories
        // Platform Plugin should only register new accessory that doesn't exist
        //  in homebridge after this event or start discover new accessories
        this.api.on('didFinishLaunching', function() {
            // Search through accessories and add them
            for (var i = 0, leni = config.accessories.length; i < leni; i++) {
                // Check to see if accessory has already been added
                for (var j = 0, exists = false, lenj = platform.accessories.length; j < lenj; j++) {
                    if (platform.accessories[j].displayName === config.accessories[i].name) {
                        exists = true;
                    }
                }
                if (exists) {
                    platform.log(config.accessories[i].type, config.accessories[i].name, "already registered");
                    continue;
                }
                switch (config.accessories[i].type) {
                    case "MotionSensor":
                        this.addAccessory(config.accessories[i].name);
                        break;
                    default:
                        log("Found Default:", config.accessories[i].name);
                        break;
                }
            }
            platform.log(config.name, "Init: done");
        }.bind(this));
    }

    var sqsoptions = {
        url: config.AWSsqsQueueURL,
        region: config.AWSregion,
        accessKeyId: config.AWSaccessKeyId,
        secretAccessKey: config.AWSsecretAccessKey,
        timeout: "20",
        log: this.log,
    };

    // Launch the queue monitor and worker.  the worker function is defined
    // below for readability and hoisted.
    var SQSqueue = new SQSWorker(sqsoptions, worker);

    function worker(message, done) {
        platform.log("Received Message:", message);
        try {
            // See if message matches an accessory
            for (var i = 0, leni = config.accessories.length; i < leni; i++) {
                if (message.match(config.accessories[i].matchrex)) {
                    platform.log("Messages matches", config.accessories[i].name);
                    break;
                }
            }
            if (i === leni) {
                platform.log("Message doesn't match any Accessory");
                done(null, true);
                return;
            }

            // Compare the current time vs. the reported time, the reported time
            // is expected to be the beginning of the string up to the comma;
            // the time is expected to be in ISO8601 format.

            // if useendtime is set, also compare the current time vs. the
            // at the end of the messate (used by alarm.com)
            // The expected format is for the message to end with
            // the time the event occurred in HH:MM [ap]m in the Timezone
            // specified in endtimeIANA_TZ.  no date.

            // TODO - Consider the case when crossing midnight - idea: if the
            // eventtime is within x minutes before midnight, check the date of
            // mailtime.  If a different date (e.g. mail received next day) - use
            // the previous day for eventtime

            var eventdatetime;
            var datetime = new Date();
            var msgdatetime = new Date(Date.parse(message.slice(0, message.search(","))));

            // Check to see if this accessory is expecting a timestamp at the end
            // of the message (this is used by Alarm.com messages)
            if (config.accessories[i].useendtime) {
                // Look for a time at the end of the message
                var eventtime = message.match(/\s(\d{1,2}:\d{2} [ap]m)$/)[0];
                var eventminutes = Number(eventtime.match(/:(\d{2})/)[1]);
                // Add offset for pm
                var eventhours = eventtime.match(/(\d{1,2}):/)[1];
                if (eventtime.match(/[ap]m$/)[0] == "pm") {
                    eventhours = Number(eventhours) + 12;
                }
                // Create eventdatetime using the reported Timezone
                eventdatetime = moment.tz([
                    msgdatetime.getFullYear(),
                    msgdatetime.getMonth(),
                    msgdatetime.getDate(),
                    eventhours,
                    eventminutes
                ], config.accessories[i].endtimeIANA_TZ);
            } else {
                // not using custom message timestamp, just set the eventdatetime
                // to the reported msgdatetime
                eventdatetime = msgdatetime;
            }

            // if the difference between when the event occured and the time this
            // program recives it is > maxEventDelay, don't process the message.

            var maxEventDelay = config.accessories[i].maxEventDelay || DEFAULT_MAX_EVENT_DELAY;

            if (parseInt((datetime - eventdatetime) / 1000) > maxEventDelay) {
                this.log("Message too old:", parseInt((datetime - msgdatetime) / 1000), "vs", maxEventDelay);
                this.log("eventdatetime  : ", eventdatetime.toISOString());
                this.log("msgdatetime   : ", msgdatetime.toISOString());
                this.log("currentDatetime: ", datetime.toISOString());
            } else {
                // All looks good, trigger the sensor state
                this.log(">>>>>> doing stuff <<<<<<<");

                // Find matching Accessory
                for (var j = 0, exists = false, lenj = platform.accessories.length; j < lenj; j++) {
                    if (platform.accessories[j].displayName === config.accessories[i].name) {
                        switch (config.accessories[i].type) {
                            case "MotionSensor":

                                var service = platform.accessories[j].getService(Service.MotionSensor);
                                // set to true
                                service.setCharacteristic(Characteristic.MotionDetected, true);
                                var noMotionTimer = config.accessories[i].noMotionTimer || DEFAULT_NO_MOTION_TIME;

                                // if a timeout is already in progress, cancel it before seeting
                                // a new one
                                if (config.accessories[i].timeout) {
                                  clearTimeout(config.accessories[i].timeout);
                                }

                                config.accessories[i].timeout = setTimeout(
                                  endMotionTimerCallback,
                                  noMotionTimer*1000,
                                  service, config.accessories[i]);
                                break;

                            default:
                                // This should never happen
                                platfor.log("Can't find a match for what do do with accessory type " + config.accessories[i].type + " in config.json");
                                break;
                        }
                        // We found a matching accessory, break the for loop.
                        break;
                    }
                }

                if (j === lenj) {
                    throw new Error('Mismatch finding a registered Platform Accessory matching config.json ' + config.accessories[i].name);
                }

            }
            // second paramter true/false notes if the message should be deleted (true)
            // or immediately released for another worker to take up (false)
            done(null, true);
        } catch (err) {
            throw err;
        }
    } // worker
}

AWSSQSPlatformInit.prototype = {
    accessories: function(callback) {
        var platform = this;
        platform.log(">>>>> accessories");
        callback();
    },

    // Function invoked when homebridge tries to restore cached accessory
    // Developer can configure accessory at here (like setup event handler)
    // Update current value
    configureAccessory: function(accessory) {
        this.log("Configuring Accessory", accessory.displayName);
        var platform = this;

        // set the accessory to reachable if plugin can currently process the accessory
        // otherwise set to false and update the reachability later by invoking
        // accessory.updateReachability()
        // accessory.reachable = true;
        accessory.reachable = true;

        accessory.on('identify', function(paired, callback) {
            platform.log(accessory.displayName, "Identify!!!");
            callback();
        });

        if (accessory.getService(Service.MotionSensor)) {
            accessory.getService(Service.MotionSensor)
                .getCharacteristic(Characteristic.MotionDetected)
                .on('set', function(value, callback) {
                    platform.log("(set):", accessory.displayName, "-> " + value);
                    callback();
                });
            // Ensure motion is initialised to false
            accessory.getService(Service.MotionSensor)
                .setCharacteristic(Characteristic.MotionDetected, false);
        }
        platform.accessories.push(accessory);
    },
    configurationRequestHandler: function(callback) {
        var platform = this;
        platform.log(">>>>> configurationRequestHandler");
    },
    addAccessory: function(accessoryName) {
        var platform = this;
        platform.log("Adding MotionSensor Accessory: ", accessoryName);
        // // Create the MotionSensor Service object
        // this.service = new Service.MotionSensor(this.name);
        // log("Initialized Accessory: ", this.name);
        var uuid;
        uuid = UUIDGen.generate(accessoryName);
        var newAccessory = new Accessory(accessoryName, uuid);

        // Make sure you provided a name for service otherwise it may not visible in some HomeKit apps.
        var motionService = newAccessory.addService(Service.MotionSensor, accessoryName);
        motionService.getCharacteristic(Characteristic.MotionDetected)
            .on('set', function(value, callback) {
                platform.log("(set):", accessoryName, "-> " + value);
                callback();
            });

        newAccessory.on('identify', function(paired, callback) {
            platform.log("(identify):", accessoryName, " Identify!!!");
            callback();
        });

        // Ensure motion is initialised to false
        motionService.setCharacteristic(Characteristic.MotionDetected, false);

        // register the accessory
        platform.api.registerPlatformAccessories("homebridge-sqs", "AWSSQSPlatform", [newAccessory]);
        platform.accessories.push(newAccessory);
        return newAccessory;
    },
    updateAccessoriesReachability: function(callback) {
        console.log(accessory.DisplayName, ">>>>> updateAccessoriesReachability");
    },
    removeAccessory: function(callback) {
        console.log(accessory.DisplayName, ">>>>> removeAccessory");
    }
};

// Callback used by setTimeout to disable MotionSesor after a set period
// of time
function endMotionTimerCallback (motionService, accessoryconfig) {
  // Set motion sensor to false
  motionService.setCharacteristic(Characteristic.MotionDetected, false);

  // delete the timeout propery
  delete accessoryconfig.timeout;
}
