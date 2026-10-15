import "./PostInstallOptions.css";
import {
  type PostInstallOptions as Options,
  type PostInstallView,
  selectablePostInstallAppIds,
  postInstallAppNames,
  scriptCompatible,
  attachedScript,
} from "../../../../shared/postInstall";
export default function PostInstallOptions({
  value,
  onChange,
  osId,
}: {
  value: Options;
  onChange: (next: Options) => void;
  osId?: string;
}) {
  const compatible = !!osId && scriptCompatible(osId);
  return (
    <section
      className="post-install-options span-2"
      aria-label="Optional post-install actions"
    >
      <div className="post-option-heading">
        <div>
          <strong>Get files</strong>
          <p>
            Selected installer files appear in the desktop’s Win11Desk
            Installers folder. They are not silently installed.
          </p>
        </div>
        <label className="post-switch">
          <input
            type="checkbox"
            role="switch"
            aria-label="Get files"
            checked={value.getFiles}
            onChange={e => onChange({ ...value, getFiles: e.target.checked })}
          />
          <span>{value.getFiles ? "On" : "Off"}</span>
        </label>
      </div>
      {value.getFiles && (
        <div className="post-file-choices">
          <div className="post-app-choices">
            {selectablePostInstallAppIds.map(id => (
              <label
                key={id}
                className={`post-app-choice ${value.apps.includes(id) ? "selected" : ""}`}
              >
                <input
                  type="checkbox"
                  aria-label={`Download ${postInstallAppNames[id]} installer`}
                  checked={value.apps.includes(id)}
                  onChange={e =>
                    onChange({
                      ...value,
                      apps: e.target.checked
                        ? [...value.apps, id]
                        : value.apps.filter(a => a !== id),
                    })
                  }
                />
                <span className={`app-letter app-${id}`} aria-hidden="true">
                  {
                    {
                      chrome: "Ch",
                      firefox: "Fx",
                      edge: "E",
                      brave: "Br",
                      "7zip": "7z",
                    }[id]
                  }
                </span>
                <span>{postInstallAppNames[id]}</span>
              </label>
            ))}
          </div>
          {value.apps.includes("chrome") && (
            <p className="form-hint">
              ChromeSetup.exe · your supplied file,13,283,768 bytes. Download
              only.
            </p>
          )}
          <label className="field">
            <span>Custom file link (optional)</span>
            <input
              type="url"
              value={value.customFileUrl}
              onChange={e =>
                onChange({ ...value, customFileUrl: e.target.value })
              }
              placeholder="https://example.com/file.zip"
            />
            <small className="form-hint">
              Direct public HTTPS .zip or .iso · max 100 MiB · downloaded only.
            </small>
          </label>
          {!value.apps.length && !value.customFileUrl && (
            <p className="form-hint">
              Select at least one file, or turn Get files Off.
            </p>
          )}
        </div>
      )}
      <div className="post-option-heading post-script-option">
        <div>
          <strong>Run attached script after installation</strong>
          <p>
            {attachedScript.name} · runs once from a protected startup task
            after Windows setup, RDP and network are ready. No login is
            required. Changes Windows licensing; no automatic edition change.
            Use only with a valid Windows license entitlement.
          </p>
          {!compatible && (
            <small className="form-hint">
              Available for Windows 10/11 client profiles only. This script’s
              HWID mode does not support Windows Server.
            </small>
          )}
        </div>
        <label className="post-switch">
          <input
            type="checkbox"
            role="switch"
            aria-label="Run attached script after installation"
            checked={value.runAttachedScript && compatible}
            disabled={!compatible}
            onChange={e =>
              onChange({ ...value, runAttachedScript: e.target.checked })
            }
          />
          <span>{value.runAttachedScript && compatible ? "On" : "Off"}</span>
        </label>
      </div>
    </section>
  );
}
const names: Record<string, string> = {
  waiting: "Waiting for Windows setup",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  timed_out: "Timed out",
  interrupted: "Interrupted — not retried",
  pending: "Pending",
  downloading: "Downloading",
  downloaded: "Downloaded",
  disabled: "Off",
};
export function PostInstallResults({ value }: { value: PostInstallView }) {
  const report = value.report;
  return (
    <div className="post-install-results">
      <p className="form-hint">
        Optional actions have their own outcome. They never replace the Windows
        installation result.
      </p>
      <div className="post-result-heading">
        <strong>
          {report ? names[report.status] : "Awaiting optional-task report"}
        </strong>
        <small>
          {value.updatedAt ? new Date(value.updatedAt).toLocaleString() : ""}
        </small>
      </div>
      {!report && (
        <p className="form-hint">
          Windows ready does not confirm these files or script have finished.
          The startup task reports separately. If no update arrives, inspect its
          protected local status before retrying; do not reinstall Windows.
        </p>
      )}
      {value.files.length > 0 && (
        <>
          <p className="form-hint">
            Desktop → {value.desktopFolder || "Win11Desk Installers"}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Selected file</th>
                  <th>Outcome</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {value.files.map(file => {
                  const r = report?.files.find(f => f.id === file.id);
                  return (
                    <tr key={file.id}>
                      <td>
                        {file.name}
                        <small className="mono">{file.filename}</small>
                      </td>
                      <td>{names[r?.status || "pending"]}</td>
                      <td>
                        {r?.bytes
                          ? `${(r.bytes / 1048576).toFixed(1)}MiB`
                          : "—"}
                        {r?.sha256 && (
                          <small className="mono" title={r.sha256}>
                            SHA256 {r.sha256.slice(0, 12)}…
                          </small>
                        )}
                        {r?.errorCode && (
                          <small>{r.errorCode.replaceAll("_", " ")}</small>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {value.script && (
        <div className="post-script-result">
          <div>
            <strong>{value.script.name}</strong>
            <small>
              {value.script.version} · pinned SHA256{" "}
              {value.script.sha256.slice(0, 12)}…
            </small>
          </div>
          <div>
            <strong>{names[report?.script.status || "pending"]}</strong>
            {report?.script.exitCode != null && (
              <small>Process exit: {report.script.exitCode}</small>
            )}
            {report?.script.activationObserved != null && (
              <small>
                {report.script.activationObserved
                  ? "Windows activation observed"
                  : "Activation not observed"}
              </small>
            )}
            {report?.script.errorCode && (
              <small>{report.script.errorCode.replaceAll("_", " ")}</small>
            )}
          </div>
        </div>
      )}
      {report?.errorCode && (
        <p className="field-error">{report.errorCode.replaceAll("_", " ")}</p>
      )}
    </div>
  );
}
