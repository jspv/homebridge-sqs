// Load the AWS SDK for Node.js
var AWS = require('aws-sdk');

// Load moment-timezone for handling of the timezone offset properly
var moment = require('moment-timezone');

// Load configurable settings from from JSON file
// AWS.config.loadFromPath('./config.json');
// del const config = require('./config.json');

AWS.config.update({
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey
});

// Create SQS service object
var sqs = new AWS.SQS({
    apiVersion: '2012-11-05'
});

function getAlarmMessageFromQueue(callback) {

    // Note - can't really havea a visiblity timeout of 0 on a Fifo;
    // if you do you need to delete the message within the same millisecond
    // for it to be considered valid.  Don't actually have to have it below as
    // it will use the queue default if not specified (in my case now it the default
    // is also 20 seconds
    var readParams = {
        AttributeNames: [
            "SentTimestamp"
        ],
        MaxNumberOfMessages: 1,
        MessageAttributeNames: [
            "All"
        ],
        QueueUrl: config.sqsQueueURL,
        VisibilityTimeout: 20,
        // For Testing
        //		WaitTimeSeconds:  5
        WaitTimeSeconds: 20
    };
    // console.log('Calling receiveMessage');
    sqs.receiveMessage(readParams, function(err, data) {
        if (err) {
            console.log("receiveMessage Error:", err.message);
            // Check to see if it's one of the errors I want to ignore (i.e.
            // if I have an Internet Outage, don't crash - just wait it out
            if (err.code === 'UnknownEndpoint' && err.retryable === true) {
                // Network may be down, keep trying
                return callback(null, null, null);
            } else {
                console.log("receiveMessage Major error:", err);
                return callback(err);
            }
        } else {
            if (data.Messages) {
                // Return the message
                return callback(null, data.Messages[0].Body, data.Messages[0].ReceiptHandle);
            } else {
                // Nothing in the queue
                // console.log('empty queue');
                return callback(null, null, null);
            }
        }
    });
}

function deleteAlarmMessageFromQueue(receiptHandle, callback) {

    var deleteParams = {
        QueueUrl: config.sqsQueueURL,
        ReceiptHandle: receiptHandle
    };

    sqs.deleteMessage(deleteParams, function(err, data) {
        if (err) {
            console.log("deleteMessage Error", err);
            return callback(err);
        } else {
            return callback(null);
        }
    });
}

function waitAndProcess() {
    getAlarmMessageFromQueue(function(err, message, receipt) {
        if (err) {
            // Got something I don't know how to deal within
            // likely need to die now
            throw err;
        }
        // if both message and receipt are null, that means that the
        // queue was empty; only process if message !== null
        if (message !== null) {

            // TODO - Get some error checking here on the expected message
            // and receipt

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

            console.log("Got Message: ", message);

            // if the difference between when the event occured and the time this
            // program recives it is > maxEventDelay, don't process the message.

            if (parseInt((datetime - eventdatetime) / 1000) > config.maxEventDelay) {
                console.log("Message too old:", parseInt((datetime - maildatetime) / 1000));
								console.log("eventdatetime  : ", eventdatetime.toISOString());
								console.log("maildatetime   : ", maildatetime.toISOString());
								console.log("currentDatetime: ", datetime.toISOString());
            } else {
                console.log(">>>>>> doing stuff <<<<<<<");
            }

            // Make sure to call this  after the message is processed
            deleteAlarmMessageFromQueue(receipt, function(err) {
                if (err) {
                    // Error deleting message
                    // Likely need to die now, throw error
                    console.log("Error Deleting Message from Queue: ", err);
                    throw err;
                } else {
                    console.log("message deleted");
                    // Loop again after message is deleted
                    waitAndProcess();
                }
            });
        } else {
            // Done, go back and look for more
            // Need to go back when either an empty queue or after the message has
            // been processed.
            waitAndProcess();
        }
    });
}

waitAndProcess();
