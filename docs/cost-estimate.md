# Cost estimate

**Status: AI cost measured on real runs (2026-10-17). Trigger.dev usage not yet measured.** The `Runs` tab in the Sheet records real tokens and cost for every run that handled mail. Check it after the first week and update this file.

## Per email (measured)
| Item | Measured | Cost |
|---|---|---|
| Claude Haiku 5.5, a real lead (qualify + draft reply) | about 2.5-3k tokens in, 0.3-0.7k out | about $0.0005 |
| Claude Haiku 5.5, an ignored email (spam, notification) | about 3k tokens in, 0.15k out | about $0.0004 |
| Poll with no new mail | no AI call | $0 |
| HubSpot (free CRM), Gmail, Calendar, Sheets | free | $0 |

Measured examples: 3 leads in one live run cost $0.00145. 9 emails (3 leads, 6 ignored) cost $0.0038. Haiku 5.5 list price: $0.10 per million input tokens, $0.50 per million output (checked 2026-10-15).

## Example month: 100 leads and 300 other emails
- **Anthropic:** 100 x $0.0005 + 300 x $0.0004 = about **$0.17, roughly R3** (assumes about R18 per US dollar, check the rate).
- **Trigger.dev:** 4,320 polls a month plus 30 follow-up sweeps. An empty poll takes a few seconds. **Not yet measured**: read the usage page in the dashboard after a few days and compare with the free $5 monthly credit. If it is too high, poll every 15 or 30 minutes (one line in `trigger/poll-leads.ts`).
- **Everything else:** free tiers (HubSpot free CRM, Gmail, Calendar, Sheets API).
- **Total: about R3 a month for AI, plus whatever Trigger.dev compute turns out to be (expected to stay inside the free credit).**

## What could change it
- The inbox is the main driver: every non-lead email still costs about $0.0004 to classify. A busy shared inbox full of newsletters costs more. A Gmail filter that keeps obvious bulk mail out of the inbox would cut it.
- Long email threads raise input tokens. Each email body is capped at 4,000 characters.
- A safety cap of 10 emails per poll stops a flood from running up cost.
- If Haiku replies are not good enough for a client, moving the call to Sonnet 5.5 ($2 / $10 per million) costs about 20 times more, still about R60 a month for this example.

## Setup costs
None. Optional: a custom domain or paid HubSpot tier if the client needs more than the free CRM.
