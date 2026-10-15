export interface ControlConfig {
  publicUrl: string;
  vaultKey: Buffer;
  bootstrapSecret: string;
  allowHttp: boolean;
}

let cached: ControlConfig | undefined;

export function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(
    hostname.replace(/^\[|\]$/g, "").toLowerCase()
  );
}

function isLoopback(url: URL): boolean {
  return isLoopbackHost(url.hostname);
}

export function config(): ControlConfig {
  if (cached) return cached;
  const publicUrl = process.env.APP_PUBLIC_URL?.trim();
  if (!publicUrl) throw new Error("APP_PUBLIC_URL is required");
  let parsed: URL;
  try {
    parsed = new URL(publicUrl);
  } catch {
    throw new Error("APP_PUBLIC_URL must be an absolute URL");
  }
  if (parsed.username || parsed.password) {
    throw new Error("APP_PUBLIC_URL must not contain URL credentials");
  }
  const allowHttp = process.env.ALLOW_HTTP_DEV === "1";
  if (
    parsed.protocol !== "https:" &&
    !(allowHttp && parsed.protocol === "http:" && isLoopback(parsed))
  ) {
    throw new Error(
      "APP_PUBLIC_URL must use HTTPS (or loopback HTTP with ALLOW_HTTP_DEV=1)"
    );
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("APP_PUBLIC_URL must contain only an origin");
  }
  const keyText = process.env.VAULT_KEY?.trim() || "";
  if (!/^[a-f0-9]{64}$/i.test(keyText))
    throw new Error("VAULT_KEY must be exactly 64 hexadecimal characters");
  const bootstrapSecret = process.env.BOOTSTRAP_SECRET?.trim() || "";
  if (bootstrapSecret.length < 32 || bootstrapSecret.length > 512) {
    throw new Error("BOOTSTRAP_SECRET must be between 32 and 512 characters");
  }
  cached = {
    publicUrl: parsed.origin,
    vaultKey: Buffer.from(keyText, "hex"),
    bootstrapSecret,
    allowHttp,
  };
  return cached;
}

export function resetConfigForTests(): void {
  cached = undefined;
}
