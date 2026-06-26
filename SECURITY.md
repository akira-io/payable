# Security Policy

## Operational hardening

The HTTP adapters do not bundle CORS or rate limiting. The host application
must mount its own CORS policy and rate limiting in front of the router,
especially for the `/refunds` and `/webhooks` routes. Authentication is
opt-in via the adapter `authenticate` hook; identity and tenant should be
derived from the authenticated principal rather than the request body. The
Express adapter caps non-webhook JSON bodies at 64kb and webhooks at 1mb.

## Outbound webhook delivery and SSRF

`deliverPendingWebhooks` POSTs to caller-registered endpoint URLs, so they are
an SSRF vector. As defense-in-depth, registration rejects non-routable hosts
(loopback, link-local, private, multicast, reserved, and documentation ranges,
including numeric/octal/hex IPv4 and IPv4-mapped IPv6), and delivery re-resolves
the host and refuses to connect when any resolved address is non-routable,
failing closed on resolution errors.

This is best-effort and does not fully close DNS rebinding: the validated
resolution is distinct from the connection the runtime's `fetch` makes, so a
precisely timed re-resolution between check and connect can still differ. SSRF
egress is ultimately a deployment concern. Enforce it at the network layer:
block outbound traffic to internal ranges with an egress proxy or firewall, and
require IMDSv2 (token-authenticated metadata) so `169.254.169.254` is not
reachable unauthenticated.

## Distributed locking

`MemoryLockDriver` is process-local: its lock map provides mutual exclusion
only within a single Node process and reports `distributed === false`. Do not
rely on it for cross-instance critical sections in a multi-instance
deployment, where it would let two instances acquire the same key. Supply a
distributed `LockDriver` (e.g. Redis-backed) for that topology.

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
