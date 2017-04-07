#!/usr/bin/perl
#
# Parse out the date and subject of a messge, decode subject if MIME-Header encoded
# Return date in JSON object with attributes "datetime" in ISO8601
# format and "message" with the subject of the mail

use strict;
use warnings;
use 5.6.1;
use Encode qw(decode);
use Mail::Internet;
use DateTime;
use DateTime::Format::Mail;

# The commented call below DOES NOT WORK, the iso861 method does not use the Timezone offset and
# just prints the datetime as if the Timezone in the DateTime object was GMT, even when
# its not!  The epoch output calcuates it correctly; use that and convert from function
# found at
#  https://www.bartbusschots.ie/s/2013/05/24/converting-unix-time-stamps-to-sql-dates-in-perl/
# Into a new object that is GMT.
# >> print $dt->iso8601(),"Z\n";
# TestCode
#                my $test = "Sun, 12 Feb 2017 11:20:04 -0800";
#                my $dt=DateTime::Format::Mail->parse_datetime($test);
#                print dt_to_iso8601($dt),"\n";

sub dt_to_iso8601{
        my $dt = shift;
        #Force the DateTime into UTC
        my $date = DateTime->from_epoch(epoch => $dt->epoch(), time_zone => 'UTC');
        return $date->ymd().q{T}.$date->hms().'Z';
}

my $mail = Mail::Internet->new( \*STDIN );
my $subject;
my $maildate;
my $datetime;
if ($mail->get('subject')) {chomp($subject = decode("MIME-Header", $mail->get('subject')))};
if ($mail->get('Date')) {
        chomp($maildate = $mail->get('Date'));
        $datetime=dt_to_iso8601(DateTime::Format::Mail->parse_datetime($maildate));
};
print "{\"datetime\":\"",$datetime || '<no date>', "\",\"message\":\"",$subject || '<no message', "\", \"source\": \"alarm.com\"}";
