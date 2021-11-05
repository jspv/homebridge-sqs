# homebridge-sqs

This plugin watches an AWS SQS queue for messages and uses the messages to trigger simulated homekit devices.  Currently it setup to emulate MotionSensor (MotionDetected events), OccupancySensor (OccupancyDetected events), and Switch (on/off events) devices, I may add more devices at a later date.  The plugin provides a variety of options for matching text and json objects (see *Configuration*).

The plugin listens to a single AWS queue specified in the platform settings.  Messages are expected to be in the format of:

{ "source": "SOURCE", "message": "actual message" }

Where *source* is the origin of the message and *message* is the message to be processed.  

# Why homebridge-sqs?

In looking for a way to use events from outside of my home network to influence homebridge, rather than setting up Internet facing services on my home network to receive outside events, I decided to use the remarkably easy-to-use Amazon SQS service to send messages securely to my homebridge server without exposing the server to the Internet.

This allows a consistent way to receive events from multiple outside sources (e.g email server, webserver receiving geofence updates, etc.)

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-sqs
3. Update your configuration file to configure your devices and what messages
to watch for. See sample-config.json in this repository for a sample.

# Configuration

## Message sources

Sources denote where the messages are coming from and how homebridge-sqs should parse them.  The sources are specified in the config file.  Each source entry in the config file requires a SOURCETYPE.  Currently three types are supported:

Currently three SOURCETYPEs are supported:
1. *textmessage*: treat the message as text and compare the message against the regular expressions specified in accessories' "matchrex" fields.
2. *endtime*: treat the message as text, but expect a timestamp at the end of the message in the format of hh:mm am/pm.  homebridge-sqs will process this messaging using the timestamp in the message as the event time rather than the timestamp of the queue message. *Note:* This format is used by alarm.com emails given potential email delays, I decided to use the embedded timestamp.  
    * the endtime format requires an "endtimeIANA_TZ" field specifying what timezone the timestamp is in.
3. *jsonmessage*: treat the message as a json object and compare the fields in the object to the fields specified in accessories' "matchjson" fields.

There can be multiple "matchrex" and "matchjson" objects in each accessory, once one is found for a particular accessory it will be processed and the rest ingore (i.e. the accessory will only receive one status change).  If a message matches multiple accessories, they will each receive the appropriate matching status change.  

### sourcefields
If a source has fields listed in a "sourcefields" array, those specified fields will be expected in addition to the required "source" and "message" fields.  These are not currently used in any way except for validating they exist.  

### Source example:
```
"sources": [{
        "source": "generic",
        "type": "textmessage"
    },
    {
        "source": "alarm.com",
        "type": "endtime",
        "endtimeIANA_TZ": "America/New_York",
        "sourcefields": [
            "datetime"
        ]
    },
    {
        "source": "locative",
        "type": "jsonmessage"
    }
],
```

## Accessories
Accessories are the homekit devices to create and trigger based on the queue messages.  

Currently supported are:
  * Motion Detector
  * Occupancy Sensor
  * Switch

*Note*: Accessories are automatically removed from homebridge when removed from config.json

## Accessory Fields

### Required Fields
  * name: the name of the Accessory
  * type: MotionSensor or Switch

### Optional Fields
  * *matchrex*: Array of object containing regular expression patterns ("rex") to look for in the message and the state (true/false) to change the characteristic of the accessory to when the pattern is matched ("state")
  * *matchjson*: Object containing key value pairs which all have to exist in the message and match exactly and the state (true/false) to change the characteristic of the accessory to when matched.   There can be other fields in the message, only the ones in matchjson will be checked.  
  * *maxEventDelay*: maximum time in seconds between the timestamp on the sqs message (or the timestamp in the message if using an "endtime" source) and the current time after which the message will be considered "too old" and will not be processed.  

  ### MotionSensor Only:
  * *noMotionTimer*: seconds of "motion" required before clearing the MotionSensor

### Accessory Example
```
{
    "name": "TestMotion",
    "type": "MotionSensor",
    "matchrex": [{
        "rex": "This is a test message",
        "state": true
    }],
    "noMotionTimer": 20
},
{
    "name": "DummySwitch",
    "type": "Switch",
},
{
    "name": "TestSwitch",
    "type": "Switch",
    "matchrex": [{
            "rex": "This is a test switch message",
            "state": true
        },
        {
            "rex": "This is a test switch off message",
            "state": false
        }
    ],
    "maxEventDelay": 90
},
{
    "name": "Im home",
    "type": "OccupancySensor",
    "matchjson": [
        {
            "fields": {
                "device_type": "iOS",
                "id": "home",
                "trigger": "enter"
            },
            "state": true
        },
        {
            "fields": {
                "device_type": "iOS",
                "id": "home",
                "trigger": "exit"
            },
            "state": false
        }
    ],
    "maxEventDelay": 30
}
```
## Platform Fields
  * "AWSaccessKeyId": "MY_AWS_ACCESS_KEY"
  * "AWSsecretAccessKey": "MY_SECRET_ACCESS_KEY"
  * "AWSregion": "YOUR_QUEUE_REGION"
  * "AWSsqsQueueURL": "https://YOUR_QUEUE_URL"

## Full configuration example:

 ```
 {
     "bridge": {
         "name": "Homebridge-SQSTEST",
         "username": "XX:XX:XX:XX:XX:XX",
         "port": 51826,
         "pin": "111-11-111"
     },

     "description": "This is an example configuration for the Script homebridge-sqs plugin",

     "platforms": [{
         "platform": "AWSSQSPlatform",
         "name": "AWS",
         "AWSaccessKeyId": "MY_AWS_ACCESS_KEY",
         "AWSsecretAccessKey": "MY_SECRET_ACCESS_KEY",
         "AWSregion": "us-east-2",
         "AWSsqsQueueURL": "https://sqs.REGION.amazonaws.com/ACCOUNT/MyHomebridgeQueue.fifo",
         "sources": [{
                 "source": "generic",
                 "type": "textmessage"
             },
             {
                 "source": "alarm.com",
                 "type": "endtime",
                 "endtimeIANA_TZ": "America/New_York",
                 "sourcefields": [
                     "datetime"
                 ]
             },
             {
                 "source": "locative",
                 "type": "jsonmessage"
             }
         ],
         "accessories": [{
                 "name": "LaundryDoor",
                 "type": "MotionSensor",
                 "matchrex": [{
                     "rex": "The Laundry Door was Opened at",
                     "state": true
                 }]
             },
             {
                 "name": "WebsiteLogin",
                 "type": "MotionSensor",
                 "matchrex": [{
                         "rex": "The Web account was logged into successfully by",
                         "state": true
                     }
                 ],
                 "maxEventDelay": 5,
                 "noMotionTimer": 30
             },
             {
                 "name": "TestMotion",
                 "type": "MotionSensor",
                 "matchrex": [{
                     "rex": "This is a test message",
                     "state": true
                 }],
                 "noMotionTimer": 20
             },
             {
                 "name": "DummySwitch",
                 "type": "Switch"
             },
             {
                 "name": "TestSwitch",
                 "type": "Switch",
                 "matchrex": [{
                         "rex": "This is a test switch message",
                         "state": true
                     },
                     {
                         "rex": "This is a test switch off message",
                         "state": false
                     }
                 ],
                 "maxEventDelay": 90
             },
             {
                 "name": "Im home",
                 "type": "OccupancySensor",
                 "matchjson": [
                     {
                         "fields": {
                             "device_type": "iOS",
                             "id": "home",
                             "trigger": "enter"
                         },
                         "state": true
                     },
                     {
                         "fields": {
                             "device_type": "iOS",
                             "id": "home",
                             "trigger": "exit"
                         },
                         "state": false
                     }
                 ],
                 "maxEventDelay": 30
             }
         ]
     }]
 }

```

## Suggestions and Testing
I use SQS FIFO (First In First Out) queues, this will probably work just fine with typical queues, but it's what I wanted to work with.  FIFO queues can have content-based deduplication which means repetative messages with exactly the same content within the deduplication interval (5 minutes) will be ignored.  he way to get around this (and general good practice) is to set a *--message-deduplication-id* for each unique message.  I use the following to send messages to the ques

```
aws sqs send-message --region us-east-2 --queue-url MYQUEUEURL --message-body '{ "source": "generic", "message": "This is a test switch off message"}' --message-deduplication-id `date +%s` --message-group-id 1
```

## Credits and apologies
This is my first attempt at writing a homebridge plugin and close to my first time using node.js/javascript.  Many plugins and stackoverflow pages were read as I looked up different ways to solve problems, unfortunately too many to note - but in particular:
* Clearly nfarina's [homebridge] (https://github.com/nfarina/homebridge) which makes this all possible and in particular the sample platform code.
* Christian Tellnes' [sqs-worker](https://github.com/tellnes/sqs-worker) which I modified slightly for this project.  Initially started writing my own, but found his was much more elegant.  
* Rudders' [homebridge-wemo](https://github.com/rudders/homebridge-wemo), good example code and easy to read.  

## TODO

## License
This work is licensed under the MIT license. See [license](LICENSE) for more details.
