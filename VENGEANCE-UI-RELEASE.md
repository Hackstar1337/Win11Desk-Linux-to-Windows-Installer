# Win11Desk — complete Vengeance UI redesign

## What changed

This is a frontend composition and interaction rebuild, not a palette-only refresh. The former large route monolith is now split into shared operational primitives and individually maintained workspace screens. The control plane uses a compact grouped navigation rail, a persistent workspace bar, keyboard-first navigation search, graphite/violet layered surfaces, local typography, numbered workflow rails and task-specific asymmetric workspaces.

| Workspace | New experience | Preserved behavior |
| --- | --- | --- |
| Fleet / Overview | Editorial fleet hero, persisted metric strip, operational entry points and split recent-report/context surfaces | Real overview API data, reported counts, refresh and navigation |
| New installer | Numbered configuration flow, command/SSH mode switching, contextual profile/safety rail and private terminal results | OS/profile/media selection, Windows credential rules, RDP port, retries/batches, optional files/scripts, advanced fields, immutable issuance, copy and expiry |
| Remote installations | Target → trust → preflight → review → launch flow, searchable queue and transport-focused detail | Password-only SSH, fingerprint checks, read-only tests, approved review digest, destructive launch approvals, cancellation and reconciliation |
| Commands | Dense inventory ledger with filters and separate artifact inspector/actions | Protected retrieval, expiry/revocation, replay-as-review, copy/download and real tracker links |
| History / deployment detail | Compact fleet rows with adjacent copy controls, reported progress and timing, detail workspace and timeline | Credential reveal expiry, labels/notes/tags, filtering, exports, trash/restore/purge, tracker and optional-work reports |
| Profiles | Readiness catalogue, split definition/runtime editor and revision/media context | Profile CRUD, archive/restore, OS catalogue, source validation, optimistic revisions, selectors and deep links |
| Operations | Health/attention/recovery/maintenance workspaces, metric and storage surfaces, notification/evidence panels | Visible-only polling, partial/unavailable states, sanitized diagnostics, storage scope, owner-only confirmed cleanup and current-session retention |
| Users / invitations | Asymmetric member registry and invite composer, explicit role/access/MFA hierarchy | Existing user/invite endpoints, backend authorization and sensitive-action verification |
| Account / appearance | Identity/security split, password/MFA/recovery/session sections and synchronized theme controls | Password rules, MFA, recovery codes, current-browser protection, other-session clearing and browser-local accents |
| Authentication / private tracker | Dedicated split auth composition and evidence-led callback report workspace | Standalone email/password setup/login/recovery/invites, private tracker token, real callback evidence and success limitations |

## Actual Vengeance UI components

Official MIT registry source was copied manually using the documented copy-in integration approach. The project remains React 19 / Vite / Tailwind 4; no framework or duplicate component library was added.

- **SpotlightNavbar:** global workspace navigation and Operations switcher. The Vite adaptation removes Next styled-jsx, scopes its CSS, supplies SPA callbacks, uses native buttons for local switches, and respects reduced motion.
- **AnimatedButton:** principal actions, authentication and secure verification. The adapted implementation preserves native button props, limits shine to hover/focus, keeps text readable and respects reduced motion.
- **AnimatedNumber:** real stored/reported numeric values only; decorative digit strips are hidden from assistive technology.
- **GlowBorderCard:** hero/metric/detail surfaces with restrained gradients. Original props are retained; the required official effect CSS is included. Dense numeric surfaces pause unnecessary looping motion.
- **KineticTextLoader:** genuine pending states. Runtime Google font requests were removed; local typography and reduced-motion styling are used.

Accessible command search and dialogs reuse the project's existing **cmdk** and **Radix** primitives. These are not represented as invented Vengeance components.

Sources: [official catalogue](https://www.vengenceui.com/components), [theming](https://www.vengenceui.com/docs/theming), [CLI/manual integration](https://www.vengenceui.com/docs/cli), and [upstream repository](https://github.com/Ashutoshx7/VengeanceUI). Exact upstream hashes, local filenames and adaptation notes are in `client/src/components/vengeance/provenance.json`; the MIT license is alongside the source. Inter and Space Grotesk are self-hosted with SIL Open Font License texts under `client/public/fonts`.

## Main file groups

- `client/src/components/control/ControlShell.tsx`: grouped navigation, workspace bar, command search, mobile menu/focus handling and shared window mark.
- `client/src/pages/control/ControlPrimitives.tsx`: reusable pages, panels, metrics, honest loading/empty/notices, copying, unchanged data loading and accessible step-up dialog.
- `client/src/pages/control/screens/*`: seven route modules and scoped workspace styles. `ControlPages.tsx` retains the stable exports used by current routes.
- `client/src/pages/control/ProfilesPage.*`, `OperationsPage.tsx`, and the existing remote-install/operations submodules: independently redesigned compositions without endpoint rewrites.
- `client/src/components/vengeance/*`, `client/src/styles/*`, `client/src/index.css`: real adapted component source, provenance, official effects and the new semantic design system.
- `client/src/pages/control/AuthPages.tsx`, `client/src/pages/Track.tsx`: coherent authentication and private tracking states.
- `client/src/components/control/ThemeColour.tsx`: unique label IDs and synchronized accent controls across account/sidebar; saved preferences remain browser-local.
- `test/ui/redesign.cjs`: actual-browser route, keyboard search, theme, responsive navigation, auth and tracker coverage using synthetic intercepted APIs.

## Boundaries

Authentication, authorization and backend/installer/worker business logic are retained. No production data is mocked, no credentials are hardcoded, and no target installation or cleanup is executed to test a visual change. All current routes and legacy redirects stay available. Clearing installation data still requires the existing owner confirmation and step-up; Clear All remains unconditional with respect to installation status, while finished-history cleanup protects unresolved/running work.

## Validation and rollout

Final result evidence is recorded in `TEST-REPORT.md` after integration checks and deployment. Browser tests use the actual application assets with intercepted synthetic API fixtures, so no real installer, cleanup or account mutation is sent to the live server. A UI regression pass is not a claim that a new Windows installation, RDP login or optional desktop file was tested.

## Appearance and interaction details

- **Violet / ultraviolet is the new-browser default.** Previously saved Cyan or other accent preferences remain untouched. All existing accent options remain available, and changing the sidebar or Account selector immediately synchronizes the other selector. This is a browser-local preference, not a database setting change.
- Use **Ctrl+K or Cmd+K** to find and navigate workspaces. This navigation palette does not run installer commands or bypass approval steps. The mobile menu restores focus when dismissed.
- Installer method switches are keyboard-accessible tabs with arrow/Home/End navigation. Fleet ledgers retain horizontal scrolling on narrow screens and sticky column headers. Credential copy controls stay adjacent to their values, including on mobile.
- Recovery codes are shown only after the existing verification action succeeds, can be copied, and have an explicit **Dismiss recovery codes** control. Selecting a different remote job immediately removes the old job's actions while its new detail is loading.
- Owner cleanup, current-browser session protection, saved profiles/settings, command expiry, private tracker access and every existing SSH launch confirmation keep their backend enforcement. This release does not rewrite or bypass those rules.

## Review corrections incorporated

The read-only integration review and actual-browser checks found and corrected a missing recovery-code output, stale remote-job detail actions during selection, missing numeric progress semantics, nested main landmarks, incomplete operational evidence layout hooks and narrow-screen grid sizing. Historical browser expectations were updated only where the redesign intentionally changes composition, navigation semantics, palette or completed-load timing; the underlying business assertions remain in place.

The final standalone ZIP includes application source, pinned lockfile, deployment instructions, these release notes, upstream MIT attribution/provenance, and local font licenses. Environment secrets, database content, host backup keys and local deployment credentials are not included.

## Verified delivery

The rebuilt control plane is deployed at [testing.d3m0nbox.online](https://testing.d3m0nbox.online). Local validation includes TypeScript/build, 350 unit tests and ten browser regression suites. The clean source ZIP independently installs, typechecks, passes all 350 tests and builds. The backed-up rollout preserves accounts/current login/profiles/settings/data; the backend bundle is unchanged and the worker/database/proxy were not restarted. No portal cleanup, Windows install or target-disk operation was performed for this release.
