# Trust My Travel Test certification

The Trust My Travel integration suite exercises the adapter against a real Test channel. It is
excluded from every standard test and coverage run. Run it only as an explicit certification step;
it is not a substitute for the deterministic provider tests.

## Activation

Set all four variables in the process that launches the suite:

| Variable | Purpose |
| --- | --- |
| `TMT_PATH` | WordPress site path that owns the Test channel |
| `TMT_API_TOKEN` | Private API bearer token |
| `TMT_CHANNEL_ID` | Positive integer Test channel identifier |
| `TMT_CHANNEL_SECRET` | Private channel authentication secret |

Run:

```sh
bun run test:integration:tmt
```

With no variables, the suite reports an explicit skip. A partial configuration fails and names only
the missing variables. It never reports configured values. The repository also provides the manual
`TMT Test integration` GitHub Actions workflow. Configure `TMT_PATH` and `TMT_CHANNEL_ID` as
environment variables and the two private values as environment secrets in the protected
`tmt-test` environment. The workflow publishes no response artifacts.

## Test-only readiness

The first network request reads the configured channel. The suite rejects the response unless the
channel ID matches, `account_mode` is exactly `test`, `account_type` is `protected-processing`,
`server_to_server` is `false`, and the base currency is valid. This guard runs before any booking
mutation. Any other mode or scope is a hard failure; the suite has no Live override.

Never pass production application credentials to this command. Rotate either private value if it
is exposed outside the secret manager or protected CI environment.

## Coverage and limitations

| Capability | Real Test coverage | Reason |
| --- | --- | --- |
| Authentication and readiness | Automated | Reads and validates the configured channel |
| Booking create, read, update, delete | Automated | Uses synthetic data and run-owned bookings |
| Checkout authentication | Automated | Reuses a run-owned booking and checks that generated HTML excludes credentials |
| HTTP error normalization | Automated | Sends an invalid, non-resource booking path |
| Checkout reuse | Automated | Repeating checkout against one booking must not create another booking |
| CardVaulter JWT and URL acquisition | Automated | Obtains the dedicated short-lived JWT and validates a pinned Test URL while `server_to_server=false` |
| CardVaulter browser presentation | Blocked | Requires opening the hosted application in a controlled browser without recording credentials |
| Card vault completion | Blocked | Requires a run-owned browser/test-card transaction and safe cleanup evidence |
| Retained purchase | Blocked | Requires a vault transaction created by the same certification run |
| Callback confirmation | Explicitly skipped | Requires a Payment Modal transaction created by the same run |
| `transaction_error` envelope capture | Explicitly skipped | Requires the Payment Modal in a controlled browser; see "Capturing a transaction_error envelope" |
| Non-terminal states and expiry | Explicitly skipped | The API cannot safely force these states without a run-owned modal transaction |
| Full and partial refunds | Explicitly skipped | Refunds require a completed transaction created by the same run |
| Chargebacks | Not automatable | TMG staff apply them manually |
| Settlement and financial protection | Not automatable | The public API cannot exercise these processes |

The configured Test channel must have server-to-server payments disabled. The suite does not accept an
external transaction ID because that would weaken resource ownership and cleanup guarantees. If
TMT enables a safe automated CardVaulter flow, extend the suite so it opens the hosted application and creates the vault transaction
itself; only then can retained-purchase support with `server_to_server=false` be certified.

## Capturing a transaction_error envelope

Payable never reports a payment outcome from a `transaction_error` envelope: every one of them
raises `PROVIDER_TMT_CALLBACK_FAILURE_UNCONFIRMED`. That is the conservative rule, chosen because no
envelope has ever been captured from Trust My Travel into this repository and Trust My Travel
documents when this event fires without publishing the statuses or codes it carries. The capture
below would establish whether a decision can reach this event at all. It confirms or relaxes the
rule; nothing depends on it, and no payment is misreported while it is outstanding.

The automated suite cannot do it. A `transaction_error` is the response the modal receives from the
`POST /transactions` it makes in the browser, with a card tokenized there. The certified Test
channel requires `server_to_server=false`, so a request the suite sent itself would be refused for
that reason rather than the one under study, and the envelope would not be the one the modal sees.
The capture is manual, in a controlled browser, and records no card data.

Two runs, against a run-owned booking on the Test channel:

1. **Does an acquirer decline create a transaction row?** Pay with the 3DS2 challenge card the
   Payment Modal appendix publishes (`developer.trustmy.group/payment-modal/appendix/`) and select
   a failing outcome in the challenge dropdown. Record which event
   fires - `transaction_failed` or `transaction_error` - the payload it carries, and
   `GET /bookings/{id}` afterwards, specifically `transaction_ids` and `total_unpaid`. A decline
   that creates a transaction row settles the question: no booking read could ever have confirmed
   one, and the conservative rule is the only correct one.
2. **What statuses reach `transaction_error`?** Force the two reproducers the modal's
   troubleshooting page names - allocations included on an authorize transaction, and a modal
   instantiated in an environment that does not match the channel's. It describes the conditions,
   not the envelopes they produce, which is what the capture is for. Record `code` and
   `data.status` for each.

Record the results in this file. Only run 1 showing a decision that reaches `transaction_error`
against a booking with no transaction row would justify reporting `failed` from this event again,
and it would have to name the status that carried it. Sanitize as the section below requires: no
card numbers, no tokens, no channel or transaction identifiers.

## Cleanup and evidence

The suite records only booking IDs returned by successful creates in the current process. Cleanup
deletes those bookings in reverse creation order. It does not delete transactions, inspect unrelated
bookings, or assume external records can be removed. A cleanup failure is sanitized and fails the
run for operator follow-up.

Test names are the certification evidence. Do not add raw provider responses, hosted payment URLs,
email addresses, channel or transaction identifiers, tokens, or secrets to logs or artifacts. The
test harness sanitizes nested diagnostic values, including configured secrets and run-owned IDs.

## Remaining certification gates

This suite unblocks repeatable Test-channel checks but does not complete the operational work in
payable issue #1079. Operators must still generate and store the API token and channel secret,
configure them for the consuming application and protected CI environment, record the raw channel
fields behind dashboard Mode and Status, confirm whether `psp` is mandatory for the
`protected-processing` channel, and create a separate channel for each additional base currency.

Bu-Payment/api issue #259 can run this suite after those credentials exist. Its real-commerce
certification must record only sanitized evidence and retain the explicit limitations above. Live
remains disabled until its separate operational and legal gates are satisfied.

---

[Previous: Credentials](20c-trust-my-travel-credentials.md) · [Index](../00-index.md) · [Next: Revolut](21-revolut.md)
