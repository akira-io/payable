# Trust My Travel credentials

Use this runbook to locate the four values required by `TrustMyTravelProvider` and place them in
approved server-side configuration. It applies to a Trust My Travel **Test** channel only. Do not
reuse Live credentials or copy a secret into chat, an issue, a pull request, a screenshot, a shell
history entry, or a repository file.

## Before you start

Sign in to the [Trust My Travel Infinity Platform](https://dashboard.trustmytravel.com). If you do
not yet have a password, use the official
[password reset page](https://dashboard.trustmytravel.com/password-forgot). Confirm that you are
working with the intended site and a channel whose dashboard Mode is `Test` before revealing or
creating credentials.

Prepare the secure destinations first. A secret that is displayed only once must go directly from
the Infinity Platform into the destination secret field or an approved password manager; it must
not pass through an intermediate note or message.

| Payable setting | TMT value | Classification |
| --- | --- | --- |
| `TMT_PATH` | Site Path | Configuration value |
| `TMT_CHANNEL_ID` | Channel ID | Configuration value |
| `TMT_API_TOKEN` | API token | Secret |
| `TMT_CHANNEL_SECRET` | Channel Secret | Secret |

## Locate the Site Path

1. In the Infinity Platform, select the **Settings** cog in the top-right corner.
2. Find the site-specific information.
3. Read **Site Path** and use it as `TMT_PATH`.

Do not substitute Site ID or Site Name. TMT documents these fields separately and the Payment
Modal expects the Site Path. See TMT's official
[Site ID, Site Name and Site Path guide](https://memberhub.trustmytravel.com/knowledgehub/site-credentials/).

## Select the Test channel

1. Select **Channels** in the left-hand menu.
2. Open the channel intended for the integration.
3. Record its numeric ID as `TMT_CHANNEL_ID`.
4. Verify the channel in the dashboard rather than relying on a previously reported value:
   - Mode is `Test`;
   - base currency is the currency configured by the consuming provider;
   - Site Path is the site selected above;
   - account and protection types are the intended ones for the integration.

Do not continue if the selected channel is Live. TMT states that a Test channel can process only
test bookings and transactions. Its
[channel-status guide](https://memberhub.trustmytravel.com/knowledgehub/check-channel-status/)
explains the dashboard modes and statuses.

Each channel has one base currency. The booking currency must match it, as documented in the
[Payment Modal reference](https://developer.trustmy.group/payment-modal/#object-configuration).
Use a separate channel and provider configuration for another base currency; never change the
currency of an existing integration silently.

## Store the Channel Secret

1. Stay on the selected Test channel.
2. Find **Channel Secret**.
3. Select **View** only when the approved destination secret field is ready.
4. Transfer the value directly into `TMT_CHANNEL_SECRET` in that destination.
5. Save the destination and clear the clipboard.

Do not paste, transcribe, log, or screenshot the value. TMT's official
[Channel Secret guide](https://memberhub.trustmytravel.com/knowledgehub/channel-secret/) documents
the **Channels → channel → View** path.

## Create and store an API token

1. Open **Settings**, then **API Tokens**.
2. Review the existing entries before creating anything. TMT permits at most two API tokens per
   site, including expired tokens.
3. Create a token only when a new one is required. Choose the expiry policy approved for the
   consuming environment.
4. When the token is revealed, transfer it directly into `TMT_API_TOKEN` in the approved secret
   destination or password manager.
5. Confirm that the destination saved it, then leave the token screen and clear the clipboard.

The token cannot be viewed again after creation. Do not invalidate or delete an existing token
merely to make room without confirming which systems use it. See TMT's official
[API Tokens guide](https://memberhub.trustmytravel.com/knowledgehub/api-tokens/) and
[API token reference](https://developer.trustmy.group/payment-modal/#authentication-api-tokens).

## Configure protected destinations

For the manual `TMT Test integration` GitHub Actions workflow, open the repository's
[Environments settings](https://github.com/akira-io/payable/settings/environments), select the
protected `tmt-test` environment, and configure names and types exactly as follows:

| Name | GitHub type |
| --- | --- |
| `TMT_PATH` | Environment variable |
| `TMT_CHANNEL_ID` | Environment variable |
| `TMT_API_TOKEN` | Environment secret |
| `TMT_CHANNEL_SECRET` | Environment secret |

GitHub does not expose a saved secret again. Verify presence by name in the environment UI or with
`gh secret list --env tmt-test --repo akira-io/payable`; verify variables with
`gh variable list --env tmt-test --repo akira-io/payable`. Do not use commands or APIs that obtain
values.

In the BuPayment dashboard, select the **Test** environment and the TMT provider account. Enter the
same four settings directly in the provider-account form and save through the dashboard's encrypted
credential flow. Do not configure Live. Verify only that the account reports all required fields as
configured; do not read the secret values back or include them in evidence.

## Verification and handoff

Record only non-secret evidence:

- the Site Path and Channel ID expected by the Test integration;
- dashboard Mode, Status and base currency;
- presence of all four setting names in each protected destination;
- the raw field names returned by `GET /channels/{id}` for the dashboard's separate Mode and Status;
- whether TMT confirms `psp` is required for transactions on the selected account type;
- whether a separate channel is available for every additional base currency.

Do not assume a previously observed channel ID, Site Path, currency, mode or account type. Confirm
each value in the current dashboard. Do not close an operational credential issue until every item
has direct evidence.

After the credentials are present, follow the
[Test certification runbook](20b-trust-my-travel-test-certification.md). Its suite is opt-in and
must run only against Test:

```sh
bun run test:integration:tmt
```

The test output and handoff to a consuming application must remain sanitized. Never attach raw TMT
responses, credentials, hosted-payment URLs, personal data, or identifiers that are not required as
non-secret evidence.

---

[Previous: Trust My Travel](20a-trust-my-travel.md) · [Index](../00-index.md) · [Next: Test certification](20b-trust-my-travel-test-certification.md)
