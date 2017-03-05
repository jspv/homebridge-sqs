# homebridge-sqs

In looking for a way to use events from outside of my home network to influence homebridge, rather than setting up Internet facing services on my home network to receive outside events, I decided to use the remarkably easy-to-use Amazon SQS service to send messages securely to my homebridge server.

This allows a consistent way for me to receive events from multiple outside sources (e.g email server, webserver receiving geofence updates, etc.) without needing separate plugins or exposing my homebridge server.

Essentially, this plugin watches an AWS SQS queue for messages and uses the messages to trigger simulated homekit devices.  Currently it setup to emulate MotionSensor (MotionDetected events) and Switch (on/off events) devices, I may add more devices at a later date.

The plugin listens to a single AWS queue specified in the platform settings.  It long polls and any messages received are compared against the strings specified in the "matchrex" field of the plugin's accessories.  The first one that matches is triggered as an active MotionSensor.

The message on the queue is expected to be in the format of:

{ "datetime" : "TIMESTAMP, "message" : "actual message"}

Where TIMESTAMP is in ISO8601 format in GMT.  

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-sqs
3. Update your configuration file to configure your devices and what messages
to watch for. See sample-config.json in this repository for a sample.

# Configuration

config.json Platform and Accessory Fields:

## Platform Fields
  * "AWSaccessKeyId": "MY_AWS_ACCESS_KEY",]
  * "AWSsecretAccessKey": "MY_SECRET_ACCESS_KEY"
  * "AWSregion": "us-east-1"
  * "AWSsqsQueueURL": "https://sqs.us-east-2.amazonaws.com/MYQUEUE/MyQueue.fifo"

## Accessory Fields

  * name: the name of the Accessory
  * type: MotionSensor or Switch
  * matchrex: Array of patterns ("rex") to look for in the message and the state (true/false) to change the characteristic of the accessory when the pattern is matched ("state")
  * useendtime: boolean - indicates that there is a timestamp at the end of the message in the format of HH:MM am/pm which should be used as the message timestamp instead of TIMESTAMP at the beginning.  Alarm.com puts these timestamps in their email notifications (one of my sources) to indicate the time the event they are reporting on occurred, figured I'd use theirs for messages in the queue that were sourced from these events.
  * endtimeIANA_TZ: The timezone the "endtime" stamp is in so that it can be properly converted and compared with the local * timezone to determine how old the event actually is.
  * maxEventDelay: seconds specifying the maximum amount of time between the current time and either TIMEZONE or the "endtime" timestamp.  If maxEventDelay is exceeded, the message is considered "too old" and not processed.  

  ### MotionSensor Only:
  * noMotionTimer: seconds of "motion" required before clearing the MotionSensor

Configuration sample:

 ```
 "platforms": [{
     "platform": "AWSSQSPlatform",
     "name": "AWS",
     "AWSaccessKeyId": "MY_AWS_ACCESS_KEY",
     "AWSsecretAccessKey": "MY_SECRET_ACCESS_KEY",
     "AWSregion": "us-east-1",
     "AWSsqsQueueURL": "https://sqs.us-east-2.amazonaws.com/MYQUEUE/MyQueue.fifo",
     "accessories": [{
             "name": "LaundryDoor",
             "type": "MotionSensor",
             "matchrex": [{
                 "rex": "The Laundry Door was Opened at",
                 "state": true
             }],
             "useendtime": true,
             "endtimeIANA_TZ": "America/New_York"
         },
         {
             "name": "WebsiteLogin",
             "type": "MotionSensor",
             "matchrex": [{
                 "rex": "The Web account was logged into successfully by",
                 "state": true
             }],
             "useendtime": true,
             "endtimeIANA_TZ": "America/New_York",
             "noMotionTimer": 30
         },
         {
             "name": "FoyerMotion",
             "type": "MotionSensor",
             "matchrex": [{
                 "rex": "They Foyer Image Motion was Activated",
                 "state": true
             }],
             "useendtime": true,
             "endtimeIANA_TZ": "America/New_York",
             "noMotionTimer": 240
         },
         {
             "name": "BarMotion",
             "type": "MotionSensor",
             "matchrex": [{
                 "rex": "The Liquor Motion was Activated",
                 "state": true
             }],
             "useendtime": true,
             "endtimeIANA_TZ": "America/New_York",
             "maxEventDelay": 120,
             "noMotionTimer": 240
         },
         {
             "name": "TestMotion",
             "type": "MotionSensor",
             "matchrex": [{
                 "rex": "This is a test message",
                 "state": true
             }],
             "useendtime": false,
             "noMotionTimer": 20
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
             ]
         }
     ]
 }]
```

## Credits and apologies
This is my first attempt at writing a homebridge plugin and close to my first time using node.js/javascript.  Many plugins and stackoverflow pages were read as I looked up different ways to solve problems, unfortunately too many to note - but in particular:
* Clearly nfarina's [homebridge] (https://github.com/nfarina/homebridge) which makes this all possible and in particular the sample platform code.
* Christian Tellnes' [sqs-worker](https://github.com/tellnes/sqs-worker) which I modified slightly for this project.  Initially started writing my own, but found his was much more elegant.  
* Rudders' [homebridge-wemo](https://github.com/rudders/homebridge-wemo), good example code and easy to read.  

## TODO
There is still something not right with the MotionSensor events - while homebridge gets them fine; I don't always see them reflected on my iOS devices nor do they trigger automations the way they should.  Switch seems to be fine.  

## License
This work is licensed under the MIT license. See [license](LICENSE) for more details.
