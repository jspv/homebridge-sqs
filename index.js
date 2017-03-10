// Load moment-timezone for handling of the timezone offset properly
var moment = require('moment-timezone');

// setup access to the queue
// uncomment below to use debug version of sqs-worker
SQSWorker = require('sqs-worker');
// var SQSWorker = require('sqs-worker');

var Service, Characteristic, HomebridgeAPI;

// Set up some defaults
// NO_MOTION_TIMER: Number of seconds before resetetting motion sensors time is in seconds
// MAX_EVENT_DELAY: Time between current time and message time that the message will still be considered valid
const DEFAULT_NO_MOTION_TIME = 60,
    DEFAULT_MAX_EVENT_DELAY = 60;


module.exports = function(homebridge) {
    console.log("homebridge API version: " + homebridge.version);
    console.log("DEBUG=(", process.env.DEBUG, ")");

    // Accessory must be created from PlatformAccessory Constructor
    Accessory = homebridge.platformAccessory;

    // Service and Characteristic are from hap-nodejs
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    HomebridgeAPI = homebridge;


    // // For Debugging
    // const util = require('util');
    // console.log("------SWITCH------");
    // console.log(util.inspect(Service.Switch, false, null));
    // console.log("------Function------");
    // console.log(Service.Switch.toString());

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

        // Listen to event "didFinishLaunching" which will trigger with homebridge
        // is finished loading cached accessories
        // Platform Plugin should only register new accessory that doesn't exist
        //  in homebridge after this event or start discover new accessories

        this.api.on('didFinishLaunching', function() {
            // Search through accessories in config.json and add any new ones.
            // TODO - remove old ones that aren't in the config.json any longer

            for (var i = 0, leni = config.accessories.length; i < leni; i++) {
                // Check to see if accessory has already been added
                for (var j = 0, exists = false, lenj = platform.accessories.length; j < lenj; j++) {
                    if (platform.accessories[j].displayName === config.accessories[i].name) {
                        exists = true;
                        platform.accessories[j].updateReachability(true);
                    }
                }
                if (exists) {
                    platform.log(config.accessories[i].type, config.accessories[i].name, "already registered");
                    continue;
                }
                // register new accessory
                switch (config.accessories[i].type) {
                    case "MotionSensor":
                    case "Switch":
                        this.addNewAccessory(config.accessories[i].type, config.accessories[i].name);
                        break;
                    default:
                        log("Found Unknown Accessory Type:", config.accessories[i].type, config.accessories[i].name);
                        break;
                }
            }
            platform.log(config.name, "Init: done");
        }.bind(this));
    }

    // Load the amazon SQS options
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
        platform.log("Received SQS Message:", message);

        // Validate and parse the message
        var msg = {};
        try {
            msg = JSON.parse(message);
            if (!("datetime" in msg && "message" in msg)) {
                throw new Error("Message missing required attributes");
            }
        } catch (e) {
            platform.log("Malformed SQS Message Error (discarding)", e);
            done(null, true);
            return;
        }

        // Messge looks OK, condinue
        platform.log.debug("datetime: ", msg.datetime);
        platform.log.debug("message:  ", msg.message);
        try {
            var i; // hold the index of the config.accessories array
            var matchrex; // hold the index of the rex the message matches.

            // See if message matches an accessory's matchrex
            accessoryloop:
                for (i = 0, leni = config.accessories.length; i < leni; i++) {
                    // Accessories aren't required to have matchrex (e.g. dumb switches)
                    if (!("matchrex" in config.accessories[i])) {
                        continue accessoryloop;
                    }
                    for (matchrex = 0; matchrex < config.accessories[i].matchrex.length; matchrex++) {
                        platform.log.debug("Comparing message to:",
                            config.accessories[i].name + "[" + matchrex + "] ",
                            config.accessories[i].matchrex[matchrex].rex);
                        if (msg.message.match(config.accessories[i].matchrex[matchrex].rex)) {
                            platform.log.debug("message matches", config.accessories[i].name + "[" + matchrex + "]" );
                            break accessoryloop;
                        }
                    }
                }
            if (i === config.accessories.length) {
                platform.log("Message doesn't match any known Accessory");
                done(null, true);
                return;
            }

            // Compare the current time vs. the reported time, the reported time
            // is expected to be the beginning of the string up to the comma;
            // the time is expected to be in ISO8601 format.

            // if useendtime is set, also compare the current time vs. the
            // at the end of the message (used by alarm.com)
            // The expected format is for the message to end with
            // the time the event occurred in HH:MM [ap]m in the Timezone
            // specified in endtimeIANA_TZ.  no date.

            // TODO - Consider the case when crossing midnight - idea: if the
            // eventtime is within x minutes before midnight, check the date of
            // mailtime.  If a different date (e.g. mail received next day) - use
            // the previous day for eventtime

            var eventdatetime;
            var datetime = new Date();
            //var msgdatetime = new Date(Date.parse(message.slice(0, message.search(","))));
            var msgdatetime = new Date(Date.parse(msg.datetime));

            // Check to see if this accessory is expecting a timestamp at the end
            // of the message (this is used by Alarm.com messages)
            if (config.accessories[i].useendtime) {
                // Look for a time at the end of the message
                var eventtime = msg.message.match(/\s(\d{1,2}:\d{2} [ap]m)$/)[0];
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

            var maxEventDelay = ("maxEventDelay" in config.accessories[i]) ? config.accessories[i].maxEventDelay : DEFAULT_MAX_EVENT_DELAY;

            if (parseInt((datetime - eventdatetime) / 1000) > maxEventDelay) {
                this.log("Message too old:", parseInt((datetime - msgdatetime) / 1000), "vs", maxEventDelay);
                this.log("eventdatetime  : ", eventdatetime.toISOString());
                this.log("msgdatetime    : ", msgdatetime.toISOString());
                this.log("currentDatetime: ", datetime.toISOString());
            } else {
                // All looks good, trigger the sensor state
                this.log(">>>>>> doing stuff <<<<<<<");

                // Find matching Accessory in the platform's accessory list
                var service;
                for (var j = 0, exists = false, lenj = platform.accessories.length; j < lenj; j++) {
                    if (platform.accessories[j].displayName === config.accessories[i].name) {
                        switch (config.accessories[i].type) {
                            case "MotionSensor":
                                // set to "MotionDetected"
                                service = platform.accessories[j].getService(Service.MotionSensor);
                                platform.log.debug("Setting", config.accessories[i].type, platform.accessories[j].displayName, "to", config.accessories[i].matchrex[matchrex].state);
                                // service.getCharacteristic(Characteristic.MotionDetected).setValue(true);
                                // service.setCharacteristic(Characteristic.MotionDetected, true);
                                service.getCharacteristic(Characteristic.MotionDetected).updateValue(config.accessories[i].matchrex[matchrex].state);


                                var noMotionTimer = ("noMotionTimer" in config.accessories[i]) ? config.accessories[i].noMotionTimer : DEFAULT_NO_MOTION_TIME;

                                // if a timeout is already in progress, cancel it before setting a new one
                                if (config.accessories[i].timeout) {
                                    clearTimeout(config.accessories[i].timeout);
                                }

                                // if noMotionTimer is not zero, set one.
                                if (noMotionTimer) {
                                    config.accessories[i].timeout = setTimeout(
                                        endMotionTimerCallback,
                                        noMotionTimer * 1000,
                                        service, config.accessories[i], platform);
                                }

                                break;

                            case "Switch":

                                service =
                                    platform.accessories[j].getService(Service.Switch);

                                platform.log.debug("Setting", config.accessories[i].type, platform.accessories[j].displayName, "to", config.accessories[i].matchrex[matchrex].state);

                                // state: true = On; false = Off
                                service.getCharacteristic(Characteristic.On).setValue(config.accessories[i].matchrex[matchrex].state);
                                //service.setCharacteristic(Characteristic.On, false);
                                break;

                            default:
                                // This should never happen
                                platform.log("Can't find a match for what do do with accessory type " + config.accessories[i].type + " in config.json");
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
        } catch (err) {
            console.log("Something really went wrong here, removing the message");
            console.log(err);
        }
        // Clear the message from the queue.
        // second paramter in done(0 true/false notes if the message should be deleted (true)
        // or immediately released for another worker to take up (false)

        done(null, true);
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
        accessory.reachable = false;

        accessory.on('identify', function(paired, callback) {
            platform.log(accessory.displayName, "Identify!!!");
            callback();
        }.bind(this));

        platform.accessories.push(accessory);
    },

    // configurationRequestHandler: function(callback) {
    //     var platform = this;
    //     platform.log(">>>>> configurationRequestHandler");
    // },

    addNewAccessory: function(accessoryType, accessoryName) {
        var platform = this;
        var service;
        var uuid;

        platform.log("Adding New ", accessoryType, "Accessory: ", accessoryName);
        uuid = UUIDGen.generate(accessoryName);
        var newAccessory = new Accessory(accessoryName, uuid);

        switch (accessoryType) {
            case "MotionSensor":
                service = newAccessory.addService(Service.MotionSensor, accessoryName);

                // console.log("About to add MD");
                service.getCharacteristic(Characteristic.MotionDetected)
                    .on('set', function(value, callback) {
                        platform.log("(set):", accessoryName, "-> " + value);
                        callback();
                    });

                // Ensure motion is initialised to false
                // motionService.setCharacteristic(Characteristic.MotionDetected, false);
                // motionService.getCharacteristic(Characteristic.MotionDetected).setValue(false);
                service.getCharacteristic(Characteristic.MotionDetected).updateValue(false);
                break;

            case "Switch":
                // console.log("About to add Switch");
                service = newAccessory.addService(Service.Switch, accessoryName);
                service.getCharacteristic(Characteristic.On)
                    .on('set', function(value, callback) {
                        platform.log("(set):", accessoryName, "-> " + value);
                        callback();
                    });

                // Ensure Switch is initialised to Off
                // switchService.setCharacteristic(Characteristic.On, false);
                service.getCharacteristic(Characteristic.On).setValue(false);
                break;

            default:
                break;
        }

        newAccessory.on('identify', function(paired, callback) {
            platform.log("(identify):", accessoryName, " Identify!!!");
            callback();
        }.bind(this));

        // register the accessory
        platform.api.registerPlatformAccessories("homebridge-sqs", "AWSSQSPlatform", [newAccessory]);
        platform.accessories.push(newAccessory);
        newAccessory.updateReachability(true);
        return newAccessory;

    }
};

// Callback used by setTimeout to disable MotionSensor after a set period
// of time
function endMotionTimerCallback(motionService, accessoryconfig, platform) {
    // Set motion sensor to false
    // motionService.setCharacteristic(Characteristic.MotionDetected, false);
    // motionService.getCharacteristic(Characteristic.MotionDetected).setValue(false);
    motionService.getCharacteristic(Characteristic.MotionDetected).updateValue(false);
    platform.log.debug("Setting", accessoryconfig.type, accessoryconfig.name, "to false");

    // delete the timeout propery
    delete accessoryconfig.timeout;
}
