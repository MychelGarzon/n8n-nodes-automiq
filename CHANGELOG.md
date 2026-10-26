[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=MychelGarzon_n8n-nodes-automiq&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=MychelGarzon_n8n-nodes-automiq)
[![npm version](https://img.shields.io/npm/v/@automiq/n8n-nodes-automiq)](https://www.npmjs.com/package/@automiq/n8n-nodes-automiq)

# AutomiQ for WhatsApp (n8n community node)

Send and receive WhatsApp messages in n8n through the [AutomiQ Gateway](https://www.automiq.fi), which uses the official WhatsApp Cloud API.

One credential, no HTTP Request nodes, no Code nodes, no secrets pasted into workflows:

- **AutomiQ for WhatsApp**: send text, media and template messages, and mark messages as read. Works as a tool for n8n AI Agents.
- **AutomiQ for WhatsApp Trigger**: receives messages and delivery statuses, verifies every delivery inside the node, and outputs one clean item per message.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

> WhatsApp is a trademark of Meta Platforms, Inc. AutomiQ is not affiliated with, endorsed by or sponsored by Meta.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Trigger](#trigger) · [Example workflow](#example-workflow) · [Errors](#errors) · [Compatibility](#compatibility) · [Resources](#resources) · [Version history](#version-history)

## Installation

You need an AutomiQ account with a connected WhatsApp number. Get started at [www.automiq.fi](https://www.automiq.fi).

**n8n (self-hosted or Cloud, where community nodes are allowed):**

1. Go to **Settings > Community Nodes**.
2. Select **Install** and enter `@automiq/n8n-nodes-automiq`.
3. Confirm and install.

See the n8n [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for details.

**Manual install (self-hosted):** run `npm install @automiq/n8n-nodes-automiq` in your n8n custom nodes folder (usually `~/.n8n/custom`) and restart n8n.

## Credentials

Create one **AutomiQ API** credential. Both nodes use it.

| Field              | Where to find it                                                                                     | Needed for       |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ---------------- |
| **API Key**        | AutomiQ portal > **API keys**. It starts with `amq_live_` and is shown only once when you create it. | Both nodes       |
| **Webhook Secret** | AutomiQ portal > **Webhook** > reveal the **Webhook secret** (64 characters). Not the webhook token. | The Trigger only |

When you save the credential, n8n tests the API key against AutomiQ. A wrong or revoked key shows "Invalid or revoked AutomiQ API key".

**Recommended:** in the credential, set **Allowed HTTP Request Domains** to `www.automiq.fi`, so this key can never be sent to another site from an HTTP Request node.

## Operations

All operations are under **Resource: Message**. Pick the **Sender Phone Number** from the list. It shows the numbers connected to your AutomiQ account.

### Send Text

| Field                         | Notes                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Recipient Phone Number        | International format with the country code, for example `16505551234`. Spaces, dashes, `+` and a leading `00` are removed. |
| Text                          | Up to 4096 characters.                                                                                                     |
| Options > Link Preview        | Shows a preview of the first link.                                                                                         |
| Options > Reply To Message ID | Sends the message as a reply that quotes a received message.                                                               |

Free-form messages can only be sent within 24 hours after the customer last wrote to you. Outside that window, use **Send Template**.

### Send Media

| Field                         | Notes                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Media Type                    | Image (JPEG or PNG, up to 5 MB), Document (PDF, Word, Excel, PowerPoint or TXT, up to 100 MB), Audio (AAC, AMR, MP3, M4A or OGG Opus, up to 16 MB), Video (MP4 or 3GP with H.264 and AAC, up to 16 MB). |
| Media Source                  | **URL**: a public link that starts with `https://`. WhatsApp downloads the file from there. **Media ID**: media already uploaded to WhatsApp.                                                           |
| Caption                       | Image, video and document only. Up to 1024 characters.                                                                                                                                                  |
| File Name                     | Document only. Include the extension, so WhatsApp shows the right icon.                                                                                                                                 |
| Options > Reply To Message ID | Sends the media as a reply.                                                                                                                                                                             |

### Send Template

Templates are the only way to start a conversation, or to write to someone after the 24-hour window.

| Field                       | Notes                                                                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template                    | Lists the **approved** templates of the sender number's WhatsApp account, for example `order_update (en)`. In an expression, use `name\|language_code`, for example `order_update\|en_US`. This is the same format n8n's built-in WhatsApp node uses. |
| Body Parameters             | One value per variable in the template body. For numbered variables like `{{1}}`, leave **Name** empty and keep the order. For named variables like `{{first_name}}`, fill in **Name**.                                                               |
| Options > Components (JSON) | Advanced: the full `components` array from Meta's template documentation, for header media and buttons. Replaces Body Parameters when set.                                                                                                            |

### Mark as Read

| Field                 | Notes                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Message ID            | The ID of a **received** message, for example `{{ $json.message_id }}` from the Trigger.                           |
| Show Typing Indicator | Also shows "typing..." to the customer until you reply, or for up to 25 seconds. Only use it when a reply follows. |

### Use with AI Agents

The node can be used as a tool by n8n AI Agents. A common setup: **AutomiQ for WhatsApp Trigger** > **Mark as Read** with typing indicator > **AI Agent** > **Send Text** with Recipient `{{ $json.from }}`.

## Trigger

### Setup

1. Add **AutomiQ for WhatsApp Trigger** to a workflow and select your AutomiQ API credential, with the **Webhook Secret** filled in.
2. Copy the trigger's **Production URL**.
3. In the AutomiQ portal, open **Webhook**, paste the URL and save.
4. Activate the workflow.

**Why the URL is set by hand:** AutomiQ has one webhook URL per account, and it can only be changed in the portal after a recent sign-in. There is deliberately no API to change it, because anyone who could change it could redirect every incoming message.

### Security

Every delivery is verified inside the node, before your workflow runs:

- The `x-automiq-signature` header must be the HMAC-SHA256 of the timestamp and the exact raw body, signed with your webhook secret.
- The `x-automiq-timestamp` must be within 5 minutes, which blocks replayed deliveries.

What the node answers when a delivery is rejected. None of these start the workflow:

| Response | Reason                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------- |
| `401`    | Missing or wrong signature, missing or stale timestamp, or no Webhook Secret in the credential. |
| `400`    | The body is correctly signed but is not a JSON object.                                          |

You do not need Header Auth, a Code node or the `crypto` module setting on self-hosted n8n.

### Events

| Event                  | Starts the workflow for                                        |
| ---------------------- | -------------------------------------------------------------- |
| **Messages** (default) | Messages your customers send                                   |
| **Statuses**           | Sent, delivered, read and failed updates for messages you sent |
| **Other Events**       | Other WhatsApp changes, such as template status updates        |

Use **Messages** for reply bots. Statuses have no sender (`from`), so an expression like `{{ $json.from }}` is empty for them. When one delivery contains both messages and statuses, you get both, messages first.

### Output

One item per message or status. Each item also includes `raw` with Meta's original object, so no field is ever lost.

**Message:**

```json
{
	"event": "message",
	"message_id": "wamid.HBgM...",
	"from": "16505551234",
	"from_user_id": "US.123456",
	"name": "Jessica",
	"type": "text",
	"timestamp": 1792772499,
	"text": "Hello!",
	"phone_number_id": "100000000000001",
	"display_phone_number": "15550001234",
	"waba_id": "200000000000002",
	"raw": { "...": "Meta's original message" }
}
```

Depending on the message type, it also has:

- `media_id`, `mime_type`, `caption` and `filename` for images, documents, audio, video and stickers.
- `reply_id` for button and list replies.
- `latitude`, `longitude`, `location_name` and `address` for locations.
- `emoji` and `reacted_message_id` for reactions.
- `reply_to_message_id` when the customer replied to a message.
- `errors` when WhatsApp could not read the message, for example type `unsupported`.

Fields that WhatsApp did not send are left out, not set to empty. This includes `timestamp`.

**Status:** `event: "status"`, `message_id`, `status`, `recipient_id`, `recipient_user_id`, `timestamp`, `errors` (for failed messages), plus the same number fields and `raw`.

### Options

| Option               | Effect                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Ignore Duplicates    | Skips messages and statuses that already started this workflow. Only works when the workflow is active.                 |
| Include Portal Pings | Also starts the workflow for the portal's **Send test delivery**. Off by default. Pings are always answered with `200`. |
| Raw Payload          | Outputs the whole delivery as one item instead of one item per message or status.                                       |

### Debugging with real messages

Use the portal's **Test webhook URL** to see real WhatsApp messages in a test run, without touching your live workflow.

While a test URL is set, every delivery to your production URL is also sent to the test URL, with the same body, signature and token. The two go out in parallel, so a slow test URL never holds up production. The test URL:

- stops receiving copies 1 hour after it was last set. **Keep for 1 more hour** restarts the hour.
- needs a sign-in from the last 10 minutes to set or extend. Removing it does not.
- receives nothing when no production URL is set.

**Option A: n8n Cloud or any public n8n**

1. Open the workflow and copy the trigger's **Test URL** (it contains `/webhook-test/`).
2. In the AutomiQ portal, open **Webhook** and paste it as the **Test webhook URL**.
3. In n8n, select **Execute workflow**, then send a WhatsApp message to your number within about 2 minutes.

n8n catches one request per listen. Other copies get `404` and are logged as failed test deliveries, which do not count in the portal's health figures.

**Option B: local n8n**

1. Expose n8n over `https`, for example with `cloudflared tunnel --url http://localhost:5678`.
2. Use `https://<your-tunnel>/webhook/<id>/webhook` as the Test webhook URL, with the workflow active.

Quick tunnel addresses change every time you start one.

**Before you test:**

- A test run executes the whole workflow, so your replies are sent twice: once by production and once by the test run. Deactivate the nodes that send messages in the editor (select the node and press `D`) and do not save.
- Do not use public request bins such as webhook.site. Anyone with the link can see the message content and the `x-automiq-token` header.
- Remove the test URL when you are done.

## Example workflow

[`examples/auto-reply.json`](examples/auto-reply.json) is a ready-to-import auto-reply:

**AutomiQ for WhatsApp Trigger** > **Mark as Read** (with typing indicator) > **Send Reply** ("Hi Jessica, thanks for your message. We will reply soon.")

1. In n8n, open a new workflow, then select **...** > **Import from File** and choose the file.
2. Select your AutomiQ API credential in all three nodes.
3. Copy the trigger's Production URL into the AutomiQ portal and activate the workflow.

The sender number comes from the incoming message, so nothing needs to be hardcoded. Replace **Send Reply** with an AI Agent to answer with AI.

## Errors

The nodes translate the most common errors into plain messages. The original WhatsApp text and code are always shown in the details.

| Message                                                    | Meaning                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Invalid or revoked AutomiQ API key                         | Create a new key in the portal and update the credential.                            |
| This AutomiQ account is suspended                          | Contact AutomiQ support.                                                             |
| This phone number is not linked to your AutomiQ account    | Pick a number from the Sender Phone Number list.                                     |
| Choose a Sender Phone Number                               | The Sender Phone Number is empty, or its expression returned nothing.                |
| AutomiQ Gateway rejected the request                       | The details show the gateway's reason.                                               |
| Outside the 24-hour customer service window (131047)       | Send an approved template instead.                                                   |
| WhatsApp could not deliver the message (131026)            | The recipient may not have WhatsApp, or cannot receive messages from this number.    |
| WhatsApp rate limit reached (130429)                       | Turn on **Retry On Fail** in the node settings, or slow the workflow down.           |
| The template parameters do not match the template (132000) | The number of Body Parameters must match the template's variables.                   |
| This template does not exist or is not approved (132001)   | Check the name, the language and the approval status in WhatsApp Manager.            |
| The recipient phone number is empty                        | An expression resolved to nothing, for example `{{ $json.from }}` on a status event. |
| ... looks like an expression typed in Fixed mode           | Click **Expression** on that field.                                                  |

With **Continue On Fail** on, the failed item gets `error` with the message and `description` with what to do.

## Compatibility

- Tested with n8n 2.44.6.
- Requires an n8n version that supports community nodes.
- No runtime dependencies.

## Resources

- [AutomiQ](https://www.automiq.fi) and the AutomiQ portal
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [WhatsApp Cloud API: send messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages)
- [WhatsApp message templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)
- [Changelog](CHANGELOG.md)

## Version history

**0.2.2**: fixes before n8n verification.

- Trigger: a missing Webhook Secret now returns `401` instead of `500`. A signed body that is not a JSON object returns `400`. Neither starts the workflow.
- Trigger: messages and statuses in the same delivery are both output. A missing timestamp is left out. Unsupported messages include WhatsApp's `errors`.
- AutomiQ for WhatsApp: a clear message when no Sender Phone Number is chosen. Continue On Fail keeps the description with the error.
- Shorter action names and clearer gateway messages.
- Example workflow, more tests, sample data uses fake numbers.

**0.2.1**: README: debugging with the portal's Test webhook URL.

**0.2.0**: first full release.

- AutomiQ API credential with a live key test and clear messages for invalid keys and suspended accounts.
- AutomiQ for WhatsApp: Send Text, Send Media, Send Template (with a list of approved templates) and Mark as Read (with an optional typing indicator). Usable as an AI Agent tool.
- AutomiQ for WhatsApp Trigger: in-node signature and timestamp verification, one clean item per message or status, and options for duplicates, portal pings and the raw payload.
- Plain-language errors for the most common gateway and WhatsApp errors.

**0.1.x**: placeholder releases used to set up publishing.

## License

[MIT](LICENSE.md)
