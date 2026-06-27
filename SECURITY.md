# Security Policy

## Operational hardening

Authentication is opt-in via the adapter `authenticate` hook; identity and
tenant should be derived from the authenticated principal rather than the
request body. The Express adapter caps non-webhook JSON bodies at 64kb and
webhooks at 1mb. List endpoints cap `limit` at 100 to bound per-request cost.

## Multi-tenant isolation

Tenant scoping on read and write paths is enforced only when `resolveTenant`
(and, where applicable, `resolveAuthorization`) is configured. In a
multi-tenant deployment these are mandatory: without `resolveTenant`, an
authenticated caller can read another tenant's payments, refunds, invoices, or
subscriptions by supplying arbitrary identifiers. Derive the tenant from the
authenticated principal, never from the request body or query.

## Rate limiting across adapters

Only the Fastify plugin bundles rate limiting (`@fastify/rate-limit`, 100/min by
default). The Express and Nest adapters do not; the host application must mount
its own rate limiter in front of the router, especially for the `/refunds` and
`/webhooks` routes and the list endpoints, which are enumerable. CORS is never
bundled and must be supplied by the host.

## MCP transport

The streamable HTTP transport enables DNS-rebinding protection by default and
validates the `Host` header against an allow-list (the bound loopback host and
port unless `allowedHosts`/`allowedOrigins` are supplied). When binding a
non-loopback interface or running without a bearer token, configure the
allow-list explicitly.

## Outbound webhook delivery and SSRF

`deliverPendingWebhooks` POSTs to caller-registered endpoint URLs, so they are
an SSRF vector. As defense-in-depth, registration rejects non-routable hosts
(loopback, link-local, private, multicast, reserved, and documentation ranges,
including numeric/octal/hex IPv4 and IPv4-mapped IPv6). The default delivery
path resolves the host once, refuses to connect when any resolved address is
non-routable (failing closed on resolution errors), and then connects through a
pinned DNS lookup that returns only that validated address, so the IP checked
is the IP connected to and a rebinding between check and connect cannot occur.

If a custom `fetch` is injected via `deliverPendingWebhooks({ fetch })`, the
pinned-lookup binding does not apply (the host check still runs, but the runtime
performs its own resolution at connect time). SSRF egress remains a deployment
concern in that case: block outbound traffic to internal ranges with an egress
proxy or firewall, and require IMDSv2 (token-authenticated metadata) so
`169.254.169.254` is not reachable unauthenticated.

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
