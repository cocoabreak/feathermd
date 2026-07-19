# Security Policy

## Supported versions

Security fixes are provided on a best-effort basis for the latest published
version of FeatherMD. Older releases and development builds may not receive
security updates.

## Reporting a vulnerability

Please do not report suspected security vulnerabilities in public issues,
discussions, or pull requests.

Use GitHub's private vulnerability reporting to submit a report:

[Report a vulnerability privately](https://github.com/cocoabreak/feathermd/security/advisories/new)

Reports may be submitted in English or Japanese.

Include the following information when possible:

- The affected FeatherMD version or commit
- Operating system and relevant environment details
- A description of the vulnerability and its potential impact
- Steps or a minimal example that reproduce the issue
- Any suggested mitigation or fix

Reports are reviewed on a best-effort basis. You may not receive an immediate
response, but please allow a reasonable amount of time before disclosing the
issue publicly.

Please do not include secrets, personal data, or unrelated sensitive files in a
report. Use minimal test data wherever possible.

## Scope

Examples of security issues that are in scope include:

- Reading files outside explicitly approved folders
- Bypassing path or trusted-root validation
- Executing active content from an untrusted Markdown document
- Bypassing HTML, SVG, CSS, link, or external-resource restrictions
- Exposing sensitive local data without clear user consent

General bugs, feature requests, and hardening suggestions without a concrete
security impact should be reported through the normal issue process.
