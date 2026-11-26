# Sign-in and local storage

This document describes version 0.4.0. Publishing source code enables inspection;
it is not an independent security audit or a guarantee of zero vulnerabilities.

## Where requests go

The app runs on Homey. Its backend sends the email address and password over
HTTPS directly to `https://app.tibber.com/login.credentials`. Subsequent Tibber
requests go to `https://app.tibber.com/v4/gql` with the returned bearer token.
These are Tibber's unofficial app endpoints, not a developer-operated proxy.
There is no developer telemetry or developer server receiving these credentials.

Review [the transport](app/lib/transport.js),
[authentication and synchronization](app/lib/engine.js), and
[Homey storage wiring](app/app.js).

## What is saved

The session token and its expiry metadata are persisted through the selected
virtual device's Homey SDK Device Store (`getStoreValue` / `setStoreValue`).
If the user selects the remember-sign-in option, email and password are also
stored there to renew the session automatically. Without that option the app
does not persist the password. Signing out clears the session and stored
credentials. They are not returned in public status responses, written to
logs, embedded in source code, or stored through the app settings API.

Device Store is persistent application storage, not a password vault. The app
does not add its own encryption layer or claim protection against a compromised
Homey, privileged access, or access to platform backups. Backup handling depends
on Homey's platform and backup settings. The app must be trusted with the
credentials entered into its password field, even though the developer does
not receive them.

## Other data and permissions

Full Homey access is used to discover/read the user-selected battery and
connection devices, and optionally request status through the Kia app. It is a
broad permission. Location is used for optional home checks and address lookup.
User-triggered address searches/reverse lookups use Photon/Komoot; those requests
can include the search address or home coordinates, but never Tibber credentials.
See [the geocoder](app/lib/geocoder.js) and [device access](app/lib/homey-client.js).

Only the selected manual vehicle's battery planning field is written in Tibber.
The app does not start/stop a charger or set the car's charging limit. Tibber
retains charging control.

## Source snapshot and tests

Production files under `app/` match the local 0.4.0 release source. Tests use
synthetic data and mock transport/storage; `cd app` then `npm test` does not
require Homey credentials or call a real Tibber account. A local regression
test's private identifier examples have been removed from this public snapshot.
Local deployment helpers, QA screenshots, archives, environment files and
runtime data are intentionally excluded.

Please do not include passwords, tokens, exact addresses or vehicle/account IDs
in public issues. For a suspected vulnerability, describe the affected area
without secrets or exploit details first so a private reporting route can be
agreed before sensitive information is shared.
