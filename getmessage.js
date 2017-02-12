// Load the AWS SDK for Node.js
var AWS = require('aws-sdk');

// Load configurable settings from from JSON file
// AWS.config.loadFromPath('./config.json');
const config = require('./config.json');

AWS.config.update( {
	region: config.region,
	accessKeyId: config.accessKeyId,
	secretAccessKey: config.secretAccessKey
});

// Create SQS service object
var sqs = new AWS.SQS({apiVersion: '2012-11-05'});

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
	console.log('Calling receiveMessage');
	sqs.receiveMessage(readParams, function(err, data) {
		if (err) {
			console.log("receiveMessage Error:", err.message);
			// Check to see if it's one of the errors I want to ignore (i.e.
			// if I have an Internet Outage, don't crash - just wait it out
			if (err.code === 'UnknownEndpoint' && err.retryable === true) {
				return callback(null,null,null);
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
				console.log('empty queue');
				return callback(null,null,null);
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
	getAlarmMessageFromQueue(function (err, message, receipt) {
		if (err) throw err;

		// if both message and receipt are null, loop again
		if (message == null && receipt == null) {
			waitAndProcess();
		} else {
			var time = new Date().toISOString();
			console.log("(",time,")", " Got Message: ", message);
			console.log("doing stuff");
			deleteAlarmMessageFromQueue(receipt, function (err) {
				if (err) {
					throw err;
				} else {
					console.log ("message deleted after stuff done");
					// Loop again
					waitAndProcess();
				}
			});
		}
	});
}


waitAndProcess();

