# Security Policy

## Operational hardening

The HTTP adapters do not bundle CORS or rate limiting. The host application
must mount its own CORS policy and rate limiting in front of the router,
especially for the `/refunds` and `/webhooks` routes. Authentication is
opt-in via the adapter `authenticate` hook; identity and tenant should be
derived from the authenticated principal rather than the request body. The
Express adapter caps non-webhook JSON bodies at 64kb and webhooks at 1mb.

## Reporting a vulnerability

Please report security vulnerabilities by email to
[kidiatoliny@gmail.com](mailto:kidiatoliny@gmail.com). Do not open a public
issue.

We will acknowledge receipt within 72 hours and will provide a more
detailed response within 7 days indicating the next steps.

## Disclosure policy

We follow coordinated disclosure. After a fix is released, we will
publish a security advisory on GitHub with credit to the reporter
(unless they prefer to remain anonymous).

## Supported versions

| Version | Status |
|---------|--------|
| Latest  | Supported |
| Older   | Best-effort backports for critical issues |
