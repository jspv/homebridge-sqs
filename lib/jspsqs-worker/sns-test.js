var AWS = require('aws-sdk')

var sns = new AWS.SNS(
    { region: 'eu-west-1'
    , 'accessKeyId': 'AKIAJM2Y4S75GA5EE3SQ'
    , 'secretAccessKey': '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'
    }
  )

var params =
  { 'Message': 'AAA'
  , 'MessageAttributes':
    { 'BBB':
      { 'DataType': 'String'
      , 'StringValue': 'The value'
      }
    }
  , 'Subject': 'a subject'
  , 'TopicArn': 'arn:aws:sns:eu-west-1:001720585999:test-ja'
  }

sns.publish(params, function(err, data) {
  if (err) console.log(err, err.stack); // an error occurred
  else     console.log(data);           // successful response
});
