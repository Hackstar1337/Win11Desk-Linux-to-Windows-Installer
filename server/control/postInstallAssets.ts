import type { Express } from "express";
import catalog from "../../shared/postInstallCatalog.json";
import {
  hasPostInstall,
  postInstallOptionsSchema,
  type PostInstallOptions,
  type PostInstallPayload,
  type PostInstallFile,
} from "../../shared/postInstall";
export function buildPostInstallPayload(
  input: PostInstallOptions | undefined,
  osId: string,
  publicOrigin?: string
): PostInstallPayload | undefined {
  if (!input) return undefined;
  // Reject unsupported payloads before the no-op shortcut or schema coercion.
  const options = postInstallOptionsSchema.parse(input);
  if (!hasPostInstall(options)) return undefined;
  if (options.apps.includes("edge"))
    throw Error("Edge is no longer offered in Get files. Choose another file.");
  const files: PostInstallFile[] = options.getFiles
    ? options.apps.map(id => {
        const f = catalog.find(c => c.id === id);
        if (!f) throw Error("Selected installer file is unavailable.");
        return {
          id,
          name: f.name,
          version: f.version,
          filename: f.filename,
          url: f.url,
          sha256: f.sha256,
          maxBytes: f.maxBytes,
          publisher: f.publisher,
          requireSignature: f.requireSignature,
          minBuild: f.minBuild,
        };
      })
    : [];
  if (options.getFiles && options.customFileUrl)
    files.push({
      id: "custom",
      name: "Custom file",
      version: "Selected link",
      filename: new URL(options.customFileUrl).pathname
        .toLowerCase()
        .endsWith(".iso")
        ? "custom-file.iso"
        : "custom-file.zip",
      url: options.customFileUrl,
      sha256: null,
      maxBytes: 104857600,
      publisher: null,
      requireSignature: false,
      minBuild: 0,
    });
  return {
    plan: {
      version: 1,
      options,
      files,
      script: null,
    },
  };
}

export function registerPostInstallAssetRoutes(_app: Express): void {
  // No third-party installer binaries or activation scripts are served by this release.
}
