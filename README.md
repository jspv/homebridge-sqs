# homebridge-sqs

Plugin that watches an AWS SQS for messages and uses the messages to trigger simulated homekit devices.  Currently it setup to emulate MotionSensor devices, I may add more devices at a later date.

The plugin listens to a single AWS queue specified in the platform settings.  It long polls and any messages received are compared against the strings specified in the "matchrex" field of the plugin's accessories.  The first one that matches is triggered as an active MotionSensor.

The message on the queue is expected to be in the format of:

TIMESTAMP,message

Where TIMESTAMP is in ISO8601 format in GMT.  

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-sqs
3. Update your configuration file to configure your devices and what messages
to watch for. See sample-config.json in this repository for a sample.

# Configuration

Fields:
  name: the name of the Motion Sensor Accessory
  type: MotionSensor
  matchrex: The pattern to look for in the message
  useendtime: boolean - indicates that there is a timestamp at the end of the message in the format of HH:MM am/pm which should be used as the message timestamp instead of TIMESTAMP at the beginning.  Alarm.com puts these timestamps in their email notifications to indicate the time the event they are reporting on occurred, figured I'd use theirs for
  messages in the queue that were sourced from these events.
  endtimeIANA_TZ: The timezone the "endtime" stamp is in so that it can be properly converted and compared with the local timezone to determine how old the event actually is.
  noMotionTimer: seconds of "motion" required before clearing the MotionSensor
  maxEventDelay: seconds specifying the maximum amount of time between the current time and either TIMEZONE or the "endtime" timestamp.  If maxEventDelay is exceeded, the message is considered "too old" and not processed.  


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
             "matchrex": "The Laundry Door was Opened at",
             "useendtime": true,
             "endtimeIANA_TZ": "America/New_York"
         },
         {
             "name": "WebsiteLogin",
             "type": "MotionSensor",
             "matchrex": "The Web account was logged into successfully by",
             "useendtime": true,
             "endtimeIANA_TZ": "America/New_York",
             "noMotionTimer": 30
         },
         {
             "name": "FoyerMotion",
             "type": "MotionSensor",
             "matchrex": "They Foyer Image Motion was Activated",
             "useendtime": true,
             "endtimeIANA_TZ": "America/New_York",
             "noMotionTimer": 240
         },
         {
             "name": "BarMotion",
             "type": "MotionSensor",
             "matchrex": "The Liquor Motion was Activated",
             "useendtime": true,
             "endtimeIANA_TZ": "America/New_York",
             "maxEventDelay": 120,
             "noMotionTimer": 240
         }
     ]
 }]

```

## Credits and apologies
This is my first attempt at writing a homebridge plugin and close to my first time using node.js/javascript.  Many plugins and stackoverflow pages were read as I looked up different ways to solve problems, unfortunately too many to note - but in particular ....

## License
This work is licensed under the MIT license. See [license](LICENSE) for more details.
