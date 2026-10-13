import { useMemo, useState } from "react";
import {
  Check,
  Code2,
  Copy,
  Download,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { commandPreview, type DeploymentConfig } from "@shared/deployment";
import { CheckOption } from "./DeploymentControls";

export default function CommandPreview({
  config,
  valid,
}: {
  config: DeploymentConfig;
  valid: boolean;
}) {
  const [platform, setPlatform] = useState<"linux" | "windows">("linux");
  const [includePassword, setIncludePassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = useMemo(
    () => commandPreview(config, platform, includePassword),
    [config, platform, includePassword]
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Preview copied. It does not run an installation.");
      setTimeout(() => setCopied(false), 2200);
    } catch {
      toast.error(
        "Clipboard is unavailable. Select and copy the preview text manually."
      );
    }
  }
  function download() {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `win11pro-preview.${platform === "linux" ? "sh" : "ps1"}`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(
      "Preview downloaded. All configuration and integration lines are comments."
    );
  }
  return (
    <section className="command-section" id="command">
      <div className="section-heading">
        <div>
          <p className="eyebrow">02 / COMMAND OUTPUT</p>
          <h2>Your configuration, in one place.</h2>
        </div>
        <span className="preview-label">
          <span /> Preview only
        </span>
      </div>
      <p className="section-description">
        Edits above update this preview instantly. An installer must be
        connected before any OS can be deployed.
      </p>
      <div className="command-toolbar">
        <div
          className="command-tabs"
          role="tablist"
          aria-label="Command platform"
        >
          <button
            id="linux-tab"
            role="tab"
            aria-selected={platform === "linux"}
            aria-controls="command-panel"
            className={platform === "linux" ? "active" : ""}
            onClick={() => setPlatform("linux")}
          >
            <Terminal size={15} />
            Linux
          </button>
          <button
            id="windows-tab"
            role="tab"
            aria-selected={platform === "windows"}
            aria-controls="command-panel"
            className={platform === "windows" ? "active" : ""}
            onClick={() => setPlatform("windows")}
          >
            <Code2 size={15} />
            Windows
          </button>
        </div>
        <div className="command-actions">
          <button className="text-button" onClick={download} disabled={!valid}>
            <Download size={14} />
            Download
          </button>
          <button className="copy-button" onClick={copy} disabled={!valid}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy preview"}
          </button>
        </div>
      </div>
      <div
        className="code-shell"
        id="command-panel"
        role="tabpanel"
        aria-labelledby={`${platform}-tab`}
      >
        <div className="code-caption">
          <span className="terminal-dots">
            <i />
            <i />
            <i />
          </span>
          <span>
            {platform === "linux"
              ? "win11pro-preview.sh"
              : "win11pro-preview.ps1"}
          </span>
          <span className="code-badge">READ ONLY</span>
        </div>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
      <div className="code-footer">
        <span>
          <ShieldCheck size={15} />
          Password redacted by default
        </span>
        <CheckOption
          label="Include password in output"
          checked={includePassword}
          onChange={setIncludePassword}
        />
      </div>
      {includePassword && (
        <p className="inline-warning" role="status">
          Your password is visible in this preview and will be included when
          copied or downloaded. Do not share it.
        </p>
      )}
      <p className="license-note">
        Windows 11 Pro licensing and activation are not included. Deployment
        options shown here are preferences, not compatibility guarantees.
      </p>
    </section>
  );
}
