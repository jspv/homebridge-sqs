#!/usr/bin/env python3
import re
import subprocess
import sys


def main():
    template = sys.stdin.read()
    template = parse_and_replace(template)
    sys.stdout.write(template)


def mycmd_replace(matchobj):
    """ Run command specified in matchobj.group(1), return output. """
    # print("---------- In replace -----------")
    # print("Matched: {}".format(matchobj.group(0)))
    # print("Matched: {}".format(matchobj.group(1)))

    # command will be in group(1)
    out = subprocess.run(
        matchobj.group(1),
        stdout=subprocess.PIPE,
        check=True,
        shell=True)
    # print("return = {}".format(out))
    return out.stdout.strip().decode()


def parse_and_replace(instring):
    """ Parse the input string for tokens, run replacers as needed.  """
    # Replace the token and command with the command return
    instring = re.sub(r"!MyCmd\((.+)\)",
                      mycmd_replace,
                      instring)
    return instring


if __name__ == "__main__":
    main()
