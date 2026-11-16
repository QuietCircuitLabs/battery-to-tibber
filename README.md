# Battery to Tibber

This guide describes the upcoming 0.4.0 beta. The currently published test
version may show different setup steps and Flow cards.

Automatically supply the battery level of a manually added Tibber vehicle from
a selected device in Homey, or from Flow. Tibber retains charging control.

This is an independent community integration using Tibber's unofficial app API.
The physical pilot has used Kia EV9, the Homey Kia app and Zaptec. Other car and
charger integrations need testing with their users; selection in setup is not
a claim that every model has been verified.

## Get started

1. Add your car to its existing Homey app, or prepare a Flow that supplies a
   current battery percentage. No particular manufacturer app is mandatory.
2. Add a vehicle manually in Tibber, with a battery percentage you can edit.
3. Add the **Tibber updates** device in **Battery to Tibber**, then open app settings.
4. Select and confirm the car's battery reading, or choose Flow as the source.
5. Leave AC adjustment off to send the actual percentage. Optionally read or
   enter the AC target: 60% battery + an 80% target produces 80% in Tibber;
   a 100% target sends the actual battery percentage.
6. For device input, choose connection checks. The default combines the car's
   plugged-in signal and your home charger's plugged-in signal. GPS is optional.
   A car plugged in elsewhere and another car at home can satisfy both signals;
   this mode does not identify the vehicle attached to the home charger.
7. Sign in to Tibber in the password field, select your manually added vehicle,
   and run the safe test with the percentage already displayed in Tibber.
8. Confirm the same percentage remains visible, then enable automatic updates.

No extra Flow is needed when your selected device capabilities provide all
required readings and connection signals. Homey Pro with firmware 12.4.5 or
later is required. Homey Cloud is not supported.

## Flows and refreshing

- **Provide battery level from Flow** needs only actual battery percent. The
  existing card with an AC target remains available. These cards work in Flow
  source mode. Your Flow must enforce any desired cable/home checks and must
  supply current data rather than replay an old cached reading.
- For device input with the charger signal supplied by Flow, report the current
  connected/disconnected state at least every 15 minutes and on disconnect.
  The signal expires using the configured maximum age and resets after restart.
- Optional **A vehicle status refresh is requested** can be connected to a
  refresh action provided by your car app. Configure 30, 60, 120 or 360 minutes
  and respect that app's limits. Requests are made only while automation is
  active and the charger check allows them, or when you explicitly choose no
  connection check. A request is not proof that fresh data arrived.
- The direct verified refresh adapter is currently Kia only, opt-in and subject
  to the car's reported 12V alarm threshold. Other brands use their own app/Flow.

Reading existing Homey values once a minute does not contact the car. Requesting
a refresh through the car app may contact the manufacturer's API. Writes to
Tibber are limited to one attempt every 15 minutes. Unchanged values are skipped.

## Why an update may wait

The app requires a usable battery reading and the checks you selected. Outside
the verified Kia adapter, it conservatively uses capability timestamps: a last
change timestamp does not prove the car was just polled. An unchanged value may
therefore appear stale. Check your integration's data, use the supported refresh
Flow, or supply current values through Flow instead of pretending data is fresh.
The maximum allowed age is configurable from 5 to 120 minutes (default 30).

A safe write test also consumes the 15-minute write interval. A sign-in failure
or rate limit causes backoff, not repeated sign-in attempts. Rejected credentials
pause automation. Saving credentials locally is optional; without it, a later
expired session requires manual sign-in. Pausing stops automatic session renewal.

## Privacy and permissions

Full Homey access discovers and reads your selected sources and, if opted in,
requests Kia status. No vehicle charge limit, charger start/stop, smart charging
setting or departure time is written. Only the selected Tibber battery planning
field is updated. Location permission is used for optional home checking and
user-triggered address selection. Photon/Komoot receives address searches or
the home position only when you use those buttons, never Tibber credentials.

Optional credentials and session tokens are held in the backend Device Store
on Homey, not source, public settings, status or logs. No credentials, vehicle
telemetry or locations are automatically sent to the developer. Sign out to
delete stored sign-in details. Homey backups follow the platform's settings.

## Questions and problem reports

Use this repository's **Issues** tab. Include app/Homey versions, car app name
and version, charger integration, selected source mode, and a plain-language
description of what happened. Do not post passwords, session tokens, exact home
coordinates, email addresses or complete unredacted status dumps.

[Svensk installationsguide](GUIDE.sv.md)
