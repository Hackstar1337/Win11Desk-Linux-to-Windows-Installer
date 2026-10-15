# Live history and ISO download visibility — implementation plan

## 1. Real ISO transfer telemetry

Report measured downloaded bytes and a trustworthy total for the long full-ISO integrity check before partitioning and the subsequent installer payload download. Correct CRLF/multi-response Content-Length parsing, retain indeterminate byte counts when the server does not disclose a size, report retry resets honestly, and label integrity versus payload phases separately. Do not use sparse/preallocated disk size as downloaded bytes. Show percent, progress bar, transferred/total size, phase and last report in central history and details. 100% ISO transfer is not Windows installation success. SHA-256 and pre-partition guards remain enforced. New hooks apply to newly issued immutable scripts, not previously running copies.

## 2. Live elapsed timer

Display HH:MM:SS from the persisted started timestamp (registration fallback if required). Update while the page is visible and freeze at the persisted Windows-ready completion timestamp; failed runs show their stopped duration. Keep Created, Started and Completed dates separate. Missing/stale callbacks remain unknown, not failed or successful. This is a count-up of elapsed installation time, not an invented countdown to an unknown finish time.

## 3. Aligned history cards and connection controls

Replace cramped, ID-heavy history rows with responsive, aligned entries. Show `IP ADDRESS: 64.177.9.58:22` as an example of address formatting, `Username`, and `RDP password: ********`; no first/last-character disclosure. Give IP:port, username and password individual copy actions. Password Copy obtains the credential on demand without exposing it visually; Reveal/Hide is on demand and automatically clears. Preserve dates, labels, stage, progress, Windows evidence, optional tracker/details, selection, Trash/Restore/archive and protected permanent deletion. Unknown IP/port and imported runs with unavailable credentials get honest disabled states.

## 4. No repeated admin password for Windows credentials

Remove the credential-only step-up requirement and modal from history and detail controls as explicitly requested. Retain authenticated sessions, existing credentials:reveal permission, CSRF and origin checks, encrypted vault storage, no-store responses and secret-free audit records. Do not add plaintext passwords to polling, CSV, RDP downloads, logs or browser storage. Admin-password changes, MFA changes and destructive permanent deletion keep their separate protections.

## 5. Windows-only eight-character minimum

Use an 8–128 printable-character rule consistently in installer API validation, generated automatic Bash, manual Bash password checking, and active Windows installer inputs. Reject seven characters and accept eight. Keep the existing 15–128 administrator account password rule unchanged. Existing issued artifacts and credentials remain immutable; random defaults can remain longer.

## 6. UI polish and safe release

Keep the existing navy/cyan technical-console aesthetic. Stack wordmark and subtitle with an explicit brand-copy class so a hidden close button does not break the selector. Use predictable input padding that wins against global control specificity; use clear responsive filters and readable per-deployment cards rather than a squeezed table. Keep low-motion progress transitions, tabular monospaced durations/addresses, muted metadata and cyan/green stage evidence. Test against isolated SQL and synthetic credentials/callbacks; no new Windows install, no production test account, no credential resets and no target-disk operations. Rebuild/recreate only the dashboard application on its already-authorized dedicated VPS, preserve .env and all persistent data, and provide an updated ZIP.

## Code responsibilities

- `shared/installerTelemetry.ts`, `shared/installerMediaGuard.ts`, `shared/installerTrackingHooks.ts`: shell transfer reporting and stage hooks; phase-safe telemetry.
- `shared/windowsPassword.ts`, `shared/installer.ts`, Windows input/API validators: Windows credential requirements only.
- `server/control/admin.ts`, tracking handlers: private DTO/timestamp/progress handling and credential access without repeat password.
- `client/src/components/control/DeploymentPresentation.tsx`: reusable timer, progress, connection and clipboard controls.
- `client/src/pages/control/ControlPages.tsx`, `ControlShell.tsx`, `client/src/index.css`: central history/details and concrete alignment repairs.
- Unit/BusyBox/HTTP fixtures: percent/headers, timer, eight-character boundaries, no-step-up credential permission and data secrecy.
