#!/usr/bin/env bash
#
# App Review demo: sends a WhatsApp message via Cloud API and prints the response.
#
# Meta accepts "a screen recording of the API Setup cURL script being used by you to send a message
# to a WhatsApp user number you have added as a test recipient number" as evidence for the
# whatsapp_business_messaging permission. This is that call, wrapped so the access token is read
# from .env rather than typed on screen — a token visible in a recording submitted to Meta would be
# an exposed credential.
#
#   ./scripts/_wa-review-demo.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

# Token comes from .env; never echoed.
set -a; . ./.env; set +a

FROM_PHONE_NUMBER_ID="105557289261699"   # +1 555-091-4717 (app test number, WABA 101467983009024)
TO="447508744402"                        # verified test recipient
TEMPLATE="hello_world"                   # the only APPROVED template on this WABA

# Must be a TEMPLATE, not free text. A text message only delivers inside the 24-hour customer
# service window, and there is no window with a test recipient — Meta accepts the call, returns a
# message id, and silently drops it. That is why earlier text sends appeared to succeed but never
# arrived. Templates deliver regardless of the window, which is why Meta's own example uses one.
echo "Sending WhatsApp template message"
echo "  from phone_number_id : $FROM_PHONE_NUMBER_ID"
echo "  to                   : +$TO"
echo "  template             : $TEMPLATE (en_US)"
echo

curl -s -X POST "https://graph.facebook.com/v21.0/${FROM_PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"messaging_product\": \"whatsapp\",
    \"recipient_type\": \"individual\",
    \"to\": \"${TO}\",
    \"type\": \"template\",
    \"template\": { \"name\": \"${TEMPLATE}\", \"language\": { \"code\": \"en_US\" } }
  }" | python3 -m json.tool

echo
echo "Sent. Check WhatsApp on +${TO}."
