var AWS = require('aws-sdk');
// AWS.config.update({accessKeyId: 'KEY', secretAccessKey: 'SECRET'});
var config = require('./testsend.config.json');
// testsend.config.json format:
// {
//   "produrl": "https://sqs.us-east-2.amazonaws.com/queuenumber/quename.fifo",
//   "testurl": "http://sqs.us-east-2.amazonaws.com/queuenumber/quename.fifo",
//   "awsregion": "us-east-2"
// }

// In case awsregin for queue is different from the default (currently fifo queues)
// are nor avaialble in every region.
if (config.awsregion) {
	AWS.config.update({
	    region: config.awsregion
	});
}

var sqs = new AWS.SQS({
    apiVersion: '2012-11-05'
});

var env = process.argv.slice(2);
var type = process.argv.slice(3);

if (env[0] == "prod") {
		queue = config.produrl;
} else {
		queue = config.testurl;
}

var now = new Date();
var dedup = now.getUTCMilliseconds();
var msg = {};

if (type.length) {
    switch (type[0]) {
        case "badfields":
            msg = JSON.stringify({
                blahblah: now.toISOString(),
								source: "alarm.com",
                message: "This test message is missing required attributes"
            });
            break;
        case "switchon":
            msg = JSON.stringify({
                datetime: now.toISOString(),
								source: "generic",
                message: "This is a test switch message " + now
            });
            break;
        case "switchoff":
            msg = JSON.stringify({
								source: "alarm.com",
                datetime: now.toISOString(),
                message: "This is a test switch off message " + formatAMPM(now)
            });
            break;
        case "nomatch":
            msg = JSON.stringify({
							source: "alarm.com",
                datetime: now.toISOString(),
                message: "don't match me message " + now
            });
            break;
				case "laundry":
            msg = JSON.stringify({
                datetime: now.toISOString(),
								source:"alarm.com",
                message: "The Laundry Door was Opened at 12:14 pm"
            });
            break;
				case "webhook":
						msg = JSON.stringify({
							source: "locative",
							message: "stuff"
						});
						break;
        default:
        case "badformat":
            msg = "This is a badly formatted message which can't be parsed";
            break;
    }
} else {
    msg = JSON.stringify({
        datetime: now.toISOString(),
        message: "This is a test message " + now
    });
}

var sqsParams = {
    MessageBody: msg,
    MessageGroupId: '1',
    MessageDeduplicationId: dedup.toString(),
    QueueUrl: queue
};

sqs.sendMessage(sqsParams, function(err, data) {
    if (err) {
        console.log('ERR', err);
    }
    console.log("Sent to " + queue);
    console.log(data);
});

function formatAMPM(date) {
  var hours = date.getHours();
  var minutes = date.getMinutes();
  var ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  minutes = minutes < 10 ? '0'+minutes : minutes;
  var strTime = hours + ':' + minutes + ' ' + ampm;
  return strTime;
}
