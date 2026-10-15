export const chromeAttachment = {
  sha256: "2684f9be514e035224363ed120077dfbe09975a90c35126d188aeec4aff42d1e",
  bytes: 13283768,
  filename: "ChromeSetup.exe",
  version: "User-supplied ChromeSetup.exe",
} as const;
export const chromeAssetPath = `/api/installer/assets/chrome/${chromeAttachment.sha256}/ChromeSetup.exe`;
export const chromeAssetFile = `vendor/post-install/assets/ChromeSetup-${chromeAttachment.sha256}.exe`;
