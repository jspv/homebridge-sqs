#!/bin/bash -x
read message
echo $message
aws sqs send-message --queue-url MYPRODQUEUE  --message-body "$message" --region QUEUEREGION --message-group-id 1
