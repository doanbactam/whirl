# Security policy

Thanks for helping keep Whirl and the people who use it safe.

## Reporting a vulnerability

**Please don't open a public issue for security problems.**

Report it privately through GitHub instead: open the repository's
**Security** tab and choose **Report a vulnerability**. That creates a private
advisory only the maintainers can see.

A good report includes:

- what the issue is and where it lives (file, route, or Convex function)
- steps to reproduce, or a minimal proof of concept
- the impact you think it has (data exposure, privilege escalation, billing
  bypass, and so on)

We'll acknowledge the report within a few days, keep you posted while we work
on a fix, and credit you in the advisory once it's published (unless you'd
rather stay anonymous).

## Scope

In scope:

- the code in this repository: the web app (`apps/v2`), the Convex backend
  (`packages/backend`), and the other apps under `apps/`
- the hosted service at [whirl.chat](https://whirl.chat)

Out of scope:

- vulnerabilities in third-party services Whirl integrates with (report those
  to the vendor)
- self-hosted deployments that are misconfigured, for example secrets exposed
  through `NEXT_PUBLIC_` variables
- denial of service, spam, and social engineering

## Supported versions

Whirl ships continuously from `main`. Security fixes land there; there are no
separately maintained release branches.
