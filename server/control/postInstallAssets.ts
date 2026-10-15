import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { Express } from "express";
import {
  chromeAttachment,
  chromeAssetFile,
  chromeAssetPath,
} from "../../shared/chromeAttachment";
import catalog from "../../shared/postInstallCatalog.json";
import {
  attachedScript,
  hasPostInstall,
  postInstallOptionsSchema,
  scriptCompatible,
  type PostInstallOptions,
  type PostInstallPayload,
  type PostInstallFile,
} from "../../shared/postInstall";
export function buildPostInstallPayload(
  input: PostInstallOptions | undefined,
  osId: string,
  publicOrigin?: string
): PostInstallPayload | undefined {
  if (!input || !hasPostInstall(input)) return undefined;
  const options = postInstallOptionsSchema.parse(input);
  if (options.apps.includes("edge"))
    throw Error("Edge is no longer offered in Get files. Choose another file.");
  if (options.runAttachedScript && !scriptCompatible(osId))
    throw Error(
      "The attached script supports Windows10/11 client profiles, not Windows Server. Turn it Off for this profile."
    );
  const files: PostInstallFile[] = options.getFiles
    ? options.apps.map(id => {
        if (id === "chrome") {
          const origin = new URL(publicOrigin || "");
          if (
            origin.protocol !== "https:" ||
            origin.origin !== publicOrigin ||
            origin.username ||
            origin.password
          )
            throw Error("Chrome delivery requires a configured HTTPS origin.");
          readChromeAttachment();
          return {
            id,
            name: "Google Chrome",
            version: chromeAttachment.version,
            filename: chromeAttachment.filename,
            url: origin.origin + chromeAssetPath,
            sha256: chromeAttachment.sha256,
            maxBytes: chromeAttachment.bytes,
            publisher: "Google LLC",
            requireSignature: true,
            minBuild: 19041,
          };
        }
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
  let scriptBase64: string | undefined;
  if (options.runAttachedScript) {
    const bytes = readFileSync(
      resolve(process.cwd(), "vendor/post-install/MAS_AIO.bat")
    );
    if (
      bytes.length !== attachedScript.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== attachedScript.sha256
    )
      throw Error("Pinned attached script integrity unavailable.");
    scriptBase64 = bytes.toString("base64");
  }
  return {
    plan: {
      version: 1,
      options,
      files,
      script: options.runAttachedScript ? attachedScript : null,
    },
    ...(scriptBase64 ? { scriptBase64 } : {}),
  };
}

export function readChromeAttachment(): Buffer {
  const bytes = readFileSync(resolve(process.cwd(), chromeAssetFile));
  if (
    bytes.length !== chromeAttachment.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== chromeAttachment.sha256
  )
    throw Error("Pinned Chrome attachment integrity unavailable.");
  return bytes;
}

export function registerPostInstallAssetRoutes(app: Express): void {
  // Non-sensitive vendor file: hash-addressed and byte-identical, never a settings/capability endpoint.
  app.get(chromeAssetPath, (_req, res) => {
    try {
      const bytes = readChromeAttachment();
      res
        .set({
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Disposition": 'attachment; filename="ChromeSetup.exe"',
          "X-Content-Type-Options": "nosniff",
        })
        .type("application/octet-stream")
        .send(bytes);
    } catch {
      res.status(503).json({ error: "Pinned installer file unavailable." });
    }
  });
}
