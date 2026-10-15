# Win11Desk — compact layout and alignment revision

## Requested changes

| Area | Correction |
| --- | --- |
| Overview | Replaced the oversized headline/padding treatment with a compact content-sized summary. Reporting counts align alongside the copy on desktop and alongside their labels on mobile. Navigation actions remain available. |
| New installer — manual and SSH | Removed the entire decorative **Workflow** panel, not merely its text. Its unused styles and grid column were removed. The form now uses the freed space; all configuration fields and the actual SSH target/preflight/review/approval controls remain. |
| Deployment profiles | Replaced tall generic glowing metric cards with small semantic **Commands / Deployments** usage counts. Fixed the clipped Ready summary and the nested search border. Profile actions and saved data are unchanged. |

## Dashboard-wide alignment review

A read-only review examined Commands, deployment history/details, Operations, Users, Account, authentication and private tracking. Confirmed source/layout issues were corrected without changing business handlers: the nested Commands profile filter now matches the compact control deck; mobile deployment-label actions intentionally stack; long connection values are constrained while Copy/Reveal remain available; the active-member number receives the intended typography; account cards no longer artificially stretch to match their neighbours; full session identifiers are available through a hover title; narrow authentication links stack; and long reported tracker host/disk text can wrap.

The review's suggested Operations aspect-ratio issue was checked against the actual component implementation and was not reproduced: passing `height="auto"` already disables its default ratio. No unnecessary Operations component change was made on that basis.

## Verification scope

Browser checks use real built application assets with synthetic intercepted APIs. They do not clear production records, change accounts, initiate SSH installs or contact target disks. The expanded alignment check covers ten workspace routes at **1920, 1512, 820, 390 and 320 pixels**, including explicit compact Overview-height bounds, profile counter height, preserved large/zero counts and Workflow removal in both installer modes. Existing history geometry, adjacent Copy controls, credential lifecycle, profile issuance, optional payload, Operations, cleanup/session and SSH approval regressions remain in place.

Final results and the data-preserving deployment receipt are recorded in `TEST-REPORT.md` after completion. Responsive/code review cannot promise pixel-perfect behavior for every possible browser, zoom level or arbitrary input; this release corrects the reported defects and the confirmed issues at the tested sizes.

## Preservation

This is a frontend-only release. Backend, database/schema, installer/worker behavior, existing profiles/settings, administrator login and encrypted credentials are not changed. The test-site rollout backs up SQL/configuration/source, updates only the application, and checks existing-data hashes and worker health. It performs no live cleanup or new target installation.

## Completed release evidence

**350 unit tests and all ten browser suites pass.** Clean ZIP install/typecheck/unit/build pass. The five-width, ten-workspace synthetic browser alignment sweep also passes using the actual deployed testing-site assets. Header: about 183 px desktop / 174 px tablet / 311 px narrow mobile; profile usage: about 36 px. Trusted HTTPS, exact deployed JS/CSS, protected anonymous APIs, unchanged backend/config/accounts/data and uninterrupted healthy worker verified. Existing data was not erased during rollout or verification.
