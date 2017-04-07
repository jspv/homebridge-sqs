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
    log.debug("Using SQS Queue:", config.AWSsqsQueueURL);

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
            var i,j;
            for (i = 0, leni = config.accessories.length; i < leni; i++) {
                // Check to see if accessory has already been added
                for (j = 0, exists = false, lenj = platform.accessories.length; j < lenj; j++) {
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
                    case "OccupancySensor":
                    case "Switch":
                        this.addNewAccessory(config.accessories[i].type, config.accessories[i].name);
                        break;
                    default:
                        log("Found Unknown Accessory Type:", config.accessories[i].type, config.accessories[i].name);
                        break;
                }
            }

            // Check to see if the accessory is in the config, if not - unregister
            // it.  This has the consequence of unregistering devices perhaps
            // unintentionally if there is an error in thd config, but has the benefit
            // of not keeping ghost devices around!
            for (i = 0; i < platform.accessories.length; i++) {
                // Check to see if accessory has already been added
                for (j = 0; j < config.accessories.length; j++) {
                    if (config.accessories[j].name == platform.accessories[i].displayName) {
                        log.debug("Matched cached accessory and config:", platform.accessories[i].displayName);
                        break;
                    }
                }
                if (j == config.accessories.length) {
                    log.debug("Can't find config match for cached accessory", platform.accessories[i].displayName);
                    platform.api.unregisterPlatformAccessories(undefined, undefined, [platform.accessories[i]]);
                }
            }

            platform.log(config.name, "Init: done");
        }.bind(this));
    }

    // Load the amazon SQS options
    // The in atrributes array speicifies additional queue message attributes
    // that we wnat to get from AWS
    var sqsoptions = {
        url: config.AWSsqsQueueURL,
        region: config.AWSregion,
        accessKeyId: config.AWSaccessKeyId,
        secretAccessKey: config.AWSsecretAccessKey,
        attributes: ["SentTimestamp"],
        timeout: "20",
        log: this.log,
    };

    // Launch the queue monitor and worker.  the worker function is defined
    // below for readability and hoisted.
    var SQSqueue = new SQSWorker(sqsoptions, worker);

    function worker(message, fullmessage, done) {
        var i, j; //
        var sourceref;
        var queueMessageDateTime, nowDateTime;
        platform.log("Received SQS Message:", message);
        // platform.log.debug("Fullmessage:", fullmessage);
        queueMessageDateTime = new Date(parseInt(fullmessage.Attributes.SentTimestamp));
        nowDateTime = new Date();

        function _throw(m) {
            throw new Error(m);
        }

        // Validate and parse the message
        var msg = {};
        try {
            msg = JSON.parse(message);

            // Verify mandatory fields
            if (!(msg.source && msg.message)) {
                _throw("Missing rquired fields 'source' and 'message'");
            }

            // Check to see if there is a matching source
            for (sourceref in config.sources) {
                if (config.sources[sourceref].source === msg.source) {
                    break;
                }
            }
            if (sourceref === config.sources.length) {
                _throw("Unrecognized SQS Message source " + msg.source);
            }

            // // Verify the source is known and if the there are required fields
            if ("sourcefields" in config.sources[sourceref]) {
                config.sources[sourceref].sourcefields.forEach(function(field) {
                    if (!(field in msg)) {
                        _throw("Missing required field " + field + " from source " + msg.source);
                    }
                });
            }

        } catch (err) {
            platform.log("Malformed SQS Message Error (discarding)", err);
            platform.log.debug("Removing message from queue");
            done(null, true);
            return;
        }

        // Messge looks OK, continue
        try {
            switch (config.sources[sourceref].type) {
                case "webhook":
                    platform.log.debug("Processing 'webhook' message:");
                    platform.log.debug("message:", msg.message);
                    // platform.log("webhook = %s, message = %s", msg.webhook, msg.message);

                    platform.log("device:", msg.message.device);
                    platform.log("zone:", msg.message.id);
                    platform.log("timestamp:", new Date(parseInt(msg.message.timestamp) * 1000));

                    for (i = 0; i < config.webhooks.length; i++) {
                        j = 1;
                    }
                    break;

                case "endtime":
                    // override queueMessageDateTime with endtime
                    queueMessageDateTime = parseEndtime(msg);
                    platform.log.debug("Overrode queueMessageDateTime to ", queueMessageDateTime);
                    /* falls through */

                case "jsonmessage":
                case "textmessage":
                    platform.log.debug("Processing ", config.sources[sourceref].type, " message:");
                    platform.log.debug("message:  ", msg.message);

                    // see if any Accessories match the message
                    var matchingAccessories = findMatchingAccessories(msg);
                    if (!matchingAccessories) {
                        platform.log("Message does not match any known Accessory");
                        platform.log.debug("Removing message from queue");
                        done(null, true);
                        return;
                    }

                    // For each matching accessory, evaluate if the message time is
                    // within the max event delay and process accordingly

                    matchingAccessories.forEach(function processAccessory(accessorylistitem) {

                        // Get the matching accessory from the accesorylistitem
                        var accessory = config.accessories[accessorylistitem.index];

                        var maxEventDelay = ("maxEventDelay" in accessory) ? accessory.maxEventDelay : DEFAULT_MAX_EVENT_DELAY;

                        if ((nowDateTime.getTime() - queueMessageDateTime.getTime()) / 1000 > maxEventDelay) {
                            platform.log("Message too old for Accessory:", accessory.name, "[", parseInt((nowDateTime.getTime() - queueMessageDateTime.getTime()) / 1000), "vs", maxEventDelay, "]");
                            platform.log("queueMessageDateTime: ", queueMessageDateTime.toISOString());
                            platform.log("currentDatetime: ", nowDateTime.toISOString());
                            return;
                        }

                        // All looks good, trigger the sensor state
                        platform.log(">>>>>> doing stuff <<<<<<<");

                        var service, platformAccessoryRef;

                        // find matching registered platform accessory
                        for (i in platform.accessories) {
                            if (platform.accessories[i].displayName == accessory.name) {
                                platformAccessoryRef = i;
                            }
                        }
                        if (!platformAccessoryRef) {
                            _throw("Cant find matching platformAccessory for ", accessory.name);
                        }

                        switch (accessory.type) {
                            case "MotionSensor":
                                // set to "MotionDetected"
                                service = platform.accessories[platformAccessoryRef].getService(Service.MotionSensor);
                                platform.log.debug("Setting", accessory.type, platform.accessories[platformAccessoryRef].displayName, "to",
                                    accessorylistitem.state);

                                service.getCharacteristic(Characteristic.MotionDetected).updateValue(accessorylistitem.state);

                                var noMotionTimer = ("noMotionTimer" in accessory) ? accessory.noMotionTimer : DEFAULT_NO_MOTION_TIME;

                                // if a timeout is already in progress, cancel it before setting a new one
                                if (config.accessories[accessorylistitem.index].timeout) {
                                    clearTimeout(config.accessories[accessorylistitem.index].timeout);
                                }

                                // if noMotionTimer is not zero, set one.
                                if (noMotionTimer) {
                                    config.accessories[accessorylistitem.index].timeout = setTimeout(
                                        endMotionTimerCallback,
                                        noMotionTimer * 1000,
                                        service, config.accessories[accessorylistitem.index], platform);
                                }
                                break;

                            case "OccupancySensor":
                                service =
                                    platform.accessories[platformAccessoryRef].getService(Service.OccupancySensor);

                                platform.log.debug("Setting", accessory.type, platform.accessories[platformAccessoryRef].displayName, "to", accessorylistitem.state);

                                // state: true/false
                                service.getCharacteristic(Characteristic.OccupancyDetected).setValue(accessorylistitem.state);
                                break;

                                case "Switch":
                                    service =
                                        platform.accessories[platformAccessoryRef].getService(Service.Switch);

                                    platform.log.debug("Setting", accessory.type, platform.accessories[platformAccessoryRef].displayName, "to", accessorylistitem.state);

                                    // state: true = On; false = Off
                                    service.getCharacteristic(Characteristic.On).setValue(accessorylistitem.state);
                                    //service.setCharacteristic(Characteristic.On, false);
                                    break;

                            default:
                                // This should never happen
                                platform.log("Can't find a match for what do do with accessory type " + accessory.type + " in config.json");
                                break;
                        }

                    });
                    break;

                default:
                    platform.log("Don't have a handler for source type ", config.sources[sourceref].type);
            }
        } catch (err) {
            console.log("Something really went wrong here, removing the message");
            console.log(err);
        }
        // Clear the message from the queue.
        // second paramter in done(0 true/false notes if the message should be deleted (true)
        // or immediately released for another worker to take up (false)
        platform.log.debug("Removing message from queue");
        done(null, true);


        // Function Definitions for worker
        function parseEndtime(msg) {

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

            // Check to see if this accessory is expecting a timestamp at the end
            // of the message (this is used by Alarm.com messages)
            // delete - if (config.accessories[i].useendtime) {
            // Look for a time at the end of the message

            var eventdatetime;
            var eventtime, eventminutes, eventhours;

            try {
                if (!("endtimeIANA_TZ" in config.sources[sourceref])) {
                    throw new Error("Missing endtimeIANA_TZ in source ", msg.source);
                }
            } catch (err) {
                throw err;
            }

            try {
                platform.log.debug("msg:", msg);
                eventtime = msg.message.match(/\s(\d{1,2}:\d{2} [ap]m)$/)[0];
                eventminutes = Number(eventtime.match(/:(\d{2})/)[1]);

                // Add offset for pm
                eventhours = eventtime.match(/(\d{1,2}):/)[1];
                if ((eventtime.match(/[ap]m$/)[0] == "pm") && (eventhours !== "12")) {
                    eventhours = Number(eventhours) + 12;
                }

                // Create eventdatetime using the reported Timezone
                eventdatetime = moment.tz([
                    queueMessageDateTime.getFullYear(),
                    queueMessageDateTime.getMonth(),
                    queueMessageDateTime.getDate(),
                    eventhours,
                    eventminutes
                ], config.sources[sourceref].endtimeIANA_TZ);
                return eventdatetime.toDate();
            } catch (err) {
                platform.log("Expected endtime in message, didn't get it");
                throw (err);
            }
        } // parseEndtime


        // Search accessories for any rexs or fields matching the message, return an array of
        // Accessory Names and matching state.
        function findMatchingAccessories(msg) {

            var i, j; // counters
            var accessorylist = []; // list of matching accessories

            // Important - if the message is proper json, it gets formated as a
            // json object.  If a rex sitting exists for the accessory, we look
            // for a matching Rex.  If not, we look for fields.

            // See if message matches an accessory's matchrex.  Loop through the
            // accessories and check type and message.
            accessoryloop:
            for (i = 0, leni = config.accessories.length; i < leni; i++) {

                // See if the accessory is a Matchrex or Matchfield type and if the appropriate
                // type of message was received.
                if ("matchrex" in config.accessories[i] && typeof(msg.message) == 'string') {
                    for (j = 0; j < config.accessories[i].matchrex.length; j++) {

                        if (msg.message.match(config.accessories[i].matchrex[j].rex)) {
                            platform.log.debug("message matches", config.accessories[i].name + "[" + j + "]");

                            // push name and matching state to the accessorylist array
                            accessorylist.push({
                                "name": config.accessories[i].name,
                                "state": config.accessories[i].matchrex[j].state,
                                "index": i
                            });
                        }
                    }
                    // if the message is json, and accessor is 'jsonmessage' - check to see if *all* the fields match
                } else if ("matchjson" in config.accessories[i] && typeof(msg.message) == 'object') {
                    for (j = 0; j < config.accessories[i].matchjson.length; j++) {

                        var allfieldsmatched = true;
                        // Check to see if all the fields exist and match, if not,
                        // reject the accessory.  There may be multiple matchjson objects.
                        for (var checkfield in config.accessories[i].matchjson[j].fields) {
                            platform.log.debug("Field \"" + checkfield + "\" in msg?:", (checkfield in msg.message));

                            // Unless all the fields match, reject this matchjson block
                            if (!(checkfield in msg.message && config.accessories[i].matchjson[j].fields[checkfield] == msg.message[checkfield].trim())) {
                                var debugfield = msg.message[checkfield] ? msg.message[checkfield].trim() : "undefined";
                                platform.log.debug("field contents \"" + debugfield + "\" does not match expected content \"" +  config.accessories[i].matchjson[j].fields[checkfield]+"\"");
                                allfieldsmatched = false;
                                continue;
                            } else {
                                platform.log.debug("field contents matched expected \"" + config.accessories[i].matchjson[j].fields[checkfield] + "\"");
                            }
                        }

                        platform.log.debug("allfieldsmatched =", allfieldsmatched);
                        if (allfieldsmatched) {
                            // push name and matching state to the accessorylist array
                            accessorylist.push({
                                "name": config.accessories[i].name,
                                "state": config.accessories[i].matchjson[j].state,
                                "index": i
                            });
                        }
                    }
                } else {
                    continue accessoryloop;
                }
            }
            if (!accessorylist.length) {
                platform.log.debug("Message doesn't match any known Accessory");
                return null;
            } else {
                platform.log.debug("Found the following matching accessories: ", accessorylist);
                return accessorylist;
            }
        } // findMatchingAccessories
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

    addNewAccessory: function(accessoryType, accessoryName) {
        var platform = this;
        var service;
        var uuid;

        platform.log("Adding New ", accessoryType, "Accessory: ", accessoryName);
        uuid = UUIDGen.generate(accessoryName);
        console.log("name:", accessoryName, "uuid:", uuid);
        var newAccessory = new Accessory(accessoryName, uuid);

        switch (accessoryType) {
            case "MotionSensor":
                service = newAccessory.addService(Service.MotionSensor, accessoryName);

                service.getCharacteristic(Characteristic.MotionDetected)
                    .on('set', function(value, callback) {
                        platform.log("(set):", accessoryName, "-> " + value);
                        callback();
                    });

                // Ensure motion is initialised to false
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

            case "OccupancySensor":
            // console.log("About to add Occupancy Sensor");
            service = newAccessory.addService(Service.OccupancySensor, accessoryName);
            service.getCharacteristic(Characteristic.OccupancyDetected)
                .on('set', function(value, callback) {
                    platform.log("(set):", accessoryName, "-> " + value);
                    callback();
                });

            // Ensure Sensor  is initialised to Off
            // service.getCharacteristic(Characteristic.OccupancyDetected).setValue(false);
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
