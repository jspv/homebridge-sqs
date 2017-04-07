# Examples
Some tools and templates which can be used to integrate other services with homebridge-sqs and test its implementation

## AWS Queue creation

  * *fifoqueue.yaml*: Example Cloudformation template to automatically create a 'prod' and 'test' fifo queue.  
## Alarm.com email processing

  * *alarmdotcom-mail-datesubject.pl*: PERL script which can be used as a mail filter to parse out the Subject from alarm.com mail messages and prepare them into the message format expected by homebridge-sqs

  * *alarmdotcom-send-sqsqueue.sh*: bash script to submit the output of alarmdotcom-mail-datesubject.pl to the SQS queue.
  * In /etc/aliases:
```
# Redirect Alarm.com log messages sent to alarmlogstream@... to a script
alarmlogstream: "|/usr/local/bin/alarmdotcom-mail-datesubject.pl /usr/local/bin/alarmdotcom-send-sqsqueue.sh* >> /tmp/alarmqueue-log"
```

## Locative Integration

  * *apigateway.yaml*: Cloudformation template to create an APIGateway which takes locative *POST* requests and, formats the data into json and puts them on the queue.  Note: I only implemented POST at this time, so be sure to set locative to use POST in your geofences.
    * *IMPORTANT*, this template makes use of custom token !MyCmd() which is expecting to be replaced with the contents of the output of the specified command in the parentheses.  I did this to be able to pull in settings from a different AWS region (currently, FIFO queues aren't available in every region), it also allows me to easy edit the mappingtemplate and just jsonify and pull it in as needed.  

  * *preprocess.py*: simple python script to search for the !MyCmd() token, run the command in parentheses and output the result.  Usage:
  ```
cat apigateway.yaml | preprocess.py > apigateway-final.yaml
```

  * *mappingtemplate.vm*: The mapping template used in the apigateway.

## General Testing

  * *testsend.js*: Submit various test messages onto dev or prod queues
