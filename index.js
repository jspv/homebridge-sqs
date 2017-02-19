// Load moment-timezone for handling of the timezone offset properly
var moment = require('moment-timezone');
// setup access to the queue
var SQSWorker = require('jspsqs-worker');
var Service, Characteristic, HomebridgeAPI;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    HomebridgeAPI = homebridge;

    // 1st argument: Module original name ("homebridge-xy")
    // 2nd argument: Module name ("xy")
    // 3rd argument: Module function name ("Xy")
    homebridge.registerAccessory("homebridge-sqs", "sqs-sensor", SensorAccessory);
};

// SensorAccessory Constructor
function SensorAccessory(log, config) {
    // Load the routines to handle message processing, pass in the conifg
    // so that we can use one config file for everything
    // Note: when calling require with a second paramter, it calls the Module
    // with one paramter containing two properteis, app, and param2; in the
    // case below, config will be in the param2
    // del var getmessage = require ('./getmessage.js')(config);

    this.log = log;
    this.name = config.name;
    this.filePath = HomebridgeAPI.user.persistPath() + "/" + this.name + "_conf.txt";

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

    // Create the MotionSensor Service object
    this.service = new Service.MotionSensor(this.name);

    // testing - looking at the state directly
    // this.log(this.service.getCharacteristic(Characteristic.MotionDetected).value);

    // testing - call the getValue() which triggers the 'get' emmitter
    // this.service.getCharacteristic(Characteristic.MotionDetected).getValue();

    // Define the worker function here - this creates a closure allowing the
    // variables of this function (e.g. config) to be accessible in the worker
    // funciton

    // Get a copy of this which can be referenced in the worker function
    var that = this;

    function worker(message, done) {
        try {
            // Compare the current time vs. the reported time, the reported time
            // is expected to be the beginning of the string up to the comma;
            // the time is expected to be in ISO8601 format.

            // Also compare the current time vs. the reported time from alarm.com
            // The expected format from alarm.com is for the message to end with
            // the time the event occurred in HH:MM [ap]m in the Eastern Timezone
            // (set in alarm.com) - no date.

            // TODO - Consider the case when crossing midnight - idea: if the
            // eventtime is within x minutes before midnight, check the date of
            // mailtime.  If a different date (e.g. mail received next day) - use
            // the previous day for eventtime

            var datetime = new Date();
            var maildatetime = new Date(Date.parse(message.slice(0, message.search(","))));

            // Look for a time at the end of the message
            var eventtime = message.match(/\s(\d{1,2}:\d{2} [ap]m)$/)[0];
            var eventminutes = Number(eventtime.match(/:(\d{2})/)[1]);
            // Add offset for pm
            var eventhours = eventtime.match(/(\d{1,2}):/)[1];
            if (eventtime.match(/[ap]m$/)[0] == "pm") {
                eventhours = Number(eventhours) + 12;
            }

            // Create eventdatetime using the reported Timezone
            var eventdatetime = moment.tz([
                maildatetime.getFullYear(),
                maildatetime.getMonth(),
                maildatetime.getDate(),
                eventhours,
                eventminutes
            ], config.alarmDotComIANA_TZ);

            this.log("Got Message: ", message);

            // if the difference between when the event occured and the time this
            // program recives it is > maxEventDelay, don't process the message.

            if (parseInt((datetime - eventdatetime) / 1000) > config.maxEventDelay) {
                this.log("Message too old:", parseInt((datetime - maildatetime) / 1000));
                this.log("eventdatetime  : ", eventdatetime.toISOString());
                this.log("maildatetime   : ", maildatetime.toISOString());
                this.log("currentDatetime: ", datetime.toISOString());
            } else {
                // All looks good, trigger the sensor state
                this.log(">>>>>> doing stuff <<<<<<<");

                // set to true.
                that.service.setCharacteristic(Characteristic.MotionDetected, true);
            }
        } catch (err) {
            throw err;
        }
        // second paramter true/false notes if the message should be deleted (true)
        // or immediately released for another worker to take up (false)
        done(null, true);
    }
}

// This getState method is added to the MotionSensor Service Object
SensorAccessory.prototype.getState = function(callback) {

    this.log("state =", this.service.getCharacteristic(Characteristic.MotionDetected).value);
    // this.service.setCharacteristic(Characteristic.MotionDetected, false);
    //callback(null, true);
    callback(null, this.service.getCharacteristic(Characteristic.MotionDetected).value);
};

SensorAccessory.prototype.getServices = function() {

    // Subscribe to the 'get' emmitter and call the getState function when
    // it is received.  The function is added to the MotionSensor service object
    //  the prototype functions below.
    this.service.getCharacteristic(Characteristic.MotionDetected)
        .on('get', this.getState.bind(this));

    // initilaise to false
    this.service.setCharacteristic(Characteristic.MotionDetected, false);

    return [this.service];
};
