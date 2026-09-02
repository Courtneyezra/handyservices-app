#!/bin/bash
cd "$(dirname "$0")"
cat _head.html _replay.html walkthrough.html diagrams.html cost-model.html _foot.html > comms-desk-model.html
wc -c comms-desk-model.html
