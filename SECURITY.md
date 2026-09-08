# Security

## Deployment boundary

This beta has no built-in authentication or user-level permissions. Anyone who
can reach the app can read and change its data. Use localhost, a trusted private
network, or an authenticating reverse proxy. Do not expose the application or
Gotenberg directly to the public internet. See the
[self-hosting guide](docs/self-hosting.md).

## Public issues and private reports

Public issues are appropriate for ordinary bugs, documentation corrections,
and general hardening suggestions that do not disclose an exploitable weakness
or private information. Use synthetic examples, never real invoices, client
details, credentials, or database backups.

For suspected exploitable vulnerabilities, data exposure, or reports that need
sensitive reproduction details, use GitHub's private vulnerability reporting:
open this repository's **Security → Advisories** page and choose **Report a vulnerability**.


In a private report, include the affected version or commit, deployment setup,
expected and actual behavior, potential impact, and minimal reproduction steps.
Redact secrets and use synthetic data wherever possible. Please allow time for
assessment and a fix before publishing vulnerability details.

## Beta maintenance

This is a small beta project without a guaranteed response time or a long-term
support commitment for older versions. Reports should identify the exact
version; where safe, check whether the current code still exhibits the issue.
Keep backups before updating or reproducing problems.
