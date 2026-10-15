# Attached-script installer staging fix

The supplied VPS log shows a successful ISO download followed by an AWK syntax error in the generated `cp /configs/win11desk-attached.bat` line. This is a **Win11Desk generator bug**, not a browser download, ISO transfer or Windows activation result.

## Root cause and correction

The optional attached-script branch escaped the destination's double quotes twice. The generated AWK saw two backslashes before a quote, which closed the string incorrectly. It failed while building the temporary second-stage script.

The corrected generator serializes this fixed shell statement into a properly quoted AWK string instead of manually layering escapes:

```sh
cp /configs/win11desk-attached.bat "$os_dir/win11desk-attached.bat"
```

Options-Off/legacy output, the exact attached batch bytes and the frozen v1 launcher remain unchanged. The failure point precedes the wrapper's upstream boot-staging/install invocation; the supplied log returns to the Ubuntu prompt. No target-disk inspection or installation has been performed by this fix task.

## Verification

Before correction, actual generated patch execution reproduced six failures: attached-script On in both script-only/both modes under GNU awk, mawk and BusyBox awk. All six Off/file-only cases passed.

After correction, all **12 interpreter/option combinations pass**. The tests execute the real generated patch against pinned source fixtures, syntax-check the resulting scripts, check exact copy lines and verify staged batch bytes. Merely running `bash -n` had not caught the embedded AWK syntax bug.

The isolated HTTP test additionally issues and delivers an encrypted command, verifies its artifact hash, and executes its **full** pre-boot media/tracking/telemetry patch section with local fixtures. It never invokes the OS installer, downloads an ISO or executes the batch. All **9 HTTP checks**, **211 unit tests/37 files**, TypeScript and production build pass.

## Retry after deployment

Use **https://testing.d3m0nbox.online**. Refresh the New installer page and generate a genuinely **new command**, retaining your desired file/script switches. Do not rerun the command from the pasted log: issued installer artifacts are immutable, so it still contains the broken statement. Never edit its embedded hash or weaken verification.

The complete Windows installation and attached batch have not been retested on a real target during this repair. The VPS shown in the log was not accessed.

## Live release verified

The correction is deployed on **https://testing.d3m0nbox.online** via SSH. Four reviewed source/test/package files were updated; the app alone was rebuilt/restarted. A protected encrypted SQL/config backup and source rollback copies were retained.

Before/after verification preserves **1 account,4 commands and4 runs**, account hashes, existing encrypted artifacts/credentials, both profiles, settings/presets, audit IDs and the entire environment file. Database/proxy were not restarted. Exact attachment bytes/hash and frozen public v1 launcher digest are unchanged. Trusted HTTPS health and anonymous401 protection pass; live optional-control synthetic UI regression passes.

The actual standalone ZIP also passes clean dependency install, typecheck, all211 tests and production build. This release fixes the reproduced staging error; it does not claim a new end-to-end Windows installation or batch execution on the target VPS.
