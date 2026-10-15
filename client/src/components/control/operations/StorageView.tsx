import { Database, HardDrive, RefreshCw } from "lucide-react";
import type { OperationsStorage } from "@shared/operationsStorage";
import { formatDate } from "../api";
import type { ResourceState } from "./types";
import "./StorageView.css";

type Props = ResourceState<OperationsStorage>;
function bytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0)
    return "Unavailable";
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let amount = value;
  let unit = -1;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit++;
  }
  return `${amount.toFixed(amount >= 100 || unit < 1 ? 0 : 1)} ${units[unit]}`;
}
function MeasurementState({ state }: { state: "available" | "unavailable" }) {
  return (
    <span className={`storage-state storage-state-${state}`}>
      <i /> {state === "available" ? "Measured" : "Unavailable"}
    </span>
  );
}
function UsageBar({ percent }: { percent: number | null }) {
  const safe =
    percent !== null && Number.isFinite(percent)
      ? Math.min(100, Math.max(0, percent))
      : null;
  return (
    <div
      className="storage-usage-bar"
      role="img"
      aria-label={
        safe === null
          ? "Filesystem usage unavailable"
          : `${safe.toFixed(1)} percent used`
      }
    >
      <span style={{ width: safe === null ? "0%" : `${safe}%` }} />
    </div>
  );
}
function Unavailable({ label }: { label: string }) {
  return (
    <p className="storage-unavailable">
      {label} is unavailable for this sample.
    </p>
  );
}

export default function StorageView({ data, error, loading, reload }: Props) {
  return (
    <section
      className="ops-panel ops-vng-panel storage-panel"
      aria-labelledby="operations-storage-title"
    >
      <div className="ops-panel-heading ops-vng-heading">
        <div>
          <span className="ops-vng-section-no">00 / CAPACITY</span>
          <h2 id="operations-storage-title">Storage usage</h2>
          <p>
            Read-only measurements with bounded sampling. Shared scope is
            stated, never inferred as app-only capacity.
          </p>
        </div>
        <button
          className="secondary-button ops-vng-button"
          type="button"
          onClick={reload}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "ops-spin" : ""} /> Refresh
        </button>
      </div>
      {error && (
        <div className="ops-inline-error ops-vng-inline" role="alert">
          <span>{error}</span>
          <button className="text-button" type="button" onClick={reload}>
            Retry
          </button>
        </div>
      )}
      {loading && !data ? (
        <div className="ops-state">Loading storage measurements…</div>
      ) : data ? (
        <>
          <div className="ops-meta-line ops-vng-meta storage-meta">
            <span>
              Sample time <strong>{formatDate(data.sampledAt)}</strong>
            </span>
            <span className="mono">VISIBLE-ONLY POLLING</span>
          </div>
          <div className="storage-grid">
            <article className="storage-card">
              <div className="storage-card-title">
                <HardDrive size={16} />
                <div>
                  <h3>Shared filesystem</h3>
                  <MeasurementState state={data.filesystem.state} />
                </div>
              </div>
              {data.filesystem.state === "available" ? (
                <>
                  <div className="storage-total">
                    {bytes(data.filesystem.usedBytes)}{" "}
                    <span>used of {bytes(data.filesystem.totalBytes)}</span>
                  </div>
                  <UsageBar percent={data.filesystem.usedPercent} />
                  <dl className="storage-facts">
                    <div>
                      <dt>Used</dt>
                      <dd>
                        {bytes(data.filesystem.usedBytes)} (
                        {data.filesystem.usedPercent?.toFixed(1)}%)
                      </dd>
                    </div>
                    <div>
                      <dt>Available to service</dt>
                      <dd>{bytes(data.filesystem.availableBytes)}</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <Unavailable label="Filesystem measurement" />
              )}
              <p className="storage-scope">
                Shared server filesystem; may include other server consumers and
                is not an app-only total.
              </p>
            </article>
            <article className="storage-card">
              <div className="storage-card-title">
                <Database size={16} />
                <div>
                  <h3>Database table allocation</h3>
                  <MeasurementState state={data.database.state} />
                </div>
              </div>
              {data.database.state === "available" ? (
                <dl className="storage-facts storage-facts-large">
                  <div>
                    <dt>Allocated total</dt>
                    <dd>{bytes(data.database.allocatedBytes)}</dd>
                  </div>
                  <div>
                    <dt>Data allocation</dt>
                    <dd>{bytes(data.database.dataBytes)}</dd>
                  </div>
                  <div>
                    <dt>Index allocation</dt>
                    <dd>{bytes(data.database.indexBytes)}</dd>
                  </div>
                </dl>
              ) : (
                <Unavailable label="Database metadata measurement" />
              )}
              <p className="storage-scope">
                Estimated table allocation metadata, not the literal total size
                of the MySQL volume.
              </p>
            </article>
          </div>
          <div className="storage-subset">
            <div>
              <strong>Encrypted data subset</strong>
              <MeasurementState state={data.ciphertextSubset.state} />
            </div>
            {data.ciphertextSubset.state === "available" ? (
              <span>{bytes(data.ciphertextSubset.bytes)}</span>
            ) : (
              <Unavailable label="Ciphertext subset measurement" />
            )}
            <p>
              This measures encrypted data inside the database, not
              additional disk usage.
            </p>
          </div>
        </>
      ) : (
        <div className="ops-state">
          Storage data is not available.{" "}
          <button className="text-button" type="button" onClick={reload}>
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
