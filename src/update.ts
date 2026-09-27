import { createHash } from "node:crypto";
import { access, chmod, realpath, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { RELEASE_PUBLIC_KEY, verifyReleaseSignature } from "./release-signing";

type VersionsManifest = {
  latest: string;
  versions: string[];
};

type UpdateResult =
  | { status: "current" | "newer"; latestVersion: string }
  | { status: "windows"; latestVersion: string; installCommand: string }
  | { status: "updated"; latestVersion: string; source: "gzip" | "raw" };

type UpdateOptions = {
  currentVersion: string;
  env: Record<string, string | undefined>;
  executablePath: string;
  platform: NodeJS.Platform;
  architecture: string;
  fetch?: typeof fetch;
  signingPublicKey?: string;
  onProgress?: (message: string) => void;
};

type UpdateErrorCode =
  | "UPDATE_UNSUPPORTED_PLATFORM"
  | "UPDATE_MANIFEST_INVALID"
  | "UPDATE_DOWNLOAD_FAILED"
  | "UPDATE_VERIFICATION_FAILED"
  | "UPDATE_INSTALL_FAILED";

class UpdateError extends Error {
  code: UpdateErrorCode;
  hint: string;

  constructor({ code, message, hint }: { code: UpdateErrorCode; message: string; hint: string }) {
    super(message);
    this.name = "UpdateError";
    this.code = code;
    this.hint = hint;
  }
}

const VERSION_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;
const DEFAULT_BASE_URL = "https://dl.naps.sh";

const parseVersion = ({ version }: { version: string }) => {
  const normalized = version.startsWith("v") ? version : `v${version}`;
  const match = VERSION_PATTERN.exec(normalized);
  if (!match) {
    throw new UpdateError({
      code: "UPDATE_MANIFEST_INVALID",
      message: `Invalid release version: ${version}`,
      hint: "Try again later or report the invalid release metadata.",
    });
  }
  return {
    normalized,
    parts: [Number(match[1]), Number(match[2]), Number(match[3])] as const,
  };
};

const compareVersions = ({ left, right }: { left: string; right: string }) => {
  const leftParts = parseVersion({ version: left }).parts;
  const rightParts = parseVersion({ version: right }).parts;
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
};

const parseVersionsManifest = ({ value }: { value: unknown }): VersionsManifest => {
  if (!value || typeof value !== "object") {
    throw new UpdateError({
      code: "UPDATE_MANIFEST_INVALID",
      message: "The update manifest is invalid.",
      hint: "Try again later.",
    });
  }
  const candidate = value as Partial<VersionsManifest>;
  if (
    typeof candidate.latest !== "string" ||
    !VERSION_PATTERN.test(candidate.latest) ||
    !Array.isArray(candidate.versions) ||
    !candidate.versions.every(
      (version) => typeof version === "string" && VERSION_PATTERN.test(version),
    ) ||
    !candidate.versions.includes(candidate.latest)
  ) {
    throw new UpdateError({
      code: "UPDATE_MANIFEST_INVALID",
      message: "The update manifest is invalid.",
      hint: "Try again later.",
    });
  }
  return { latest: candidate.latest, versions: candidate.versions };
};

const getBinaryName = ({
  platform,
  architecture,
}: {
  platform: NodeJS.Platform;
  architecture: string;
}) => {
  const arch = architecture === "x64" ? "x64" : architecture === "arm64" ? "arm64" : undefined;
  if (!arch) {
    throw new UpdateError({
      code: "UPDATE_UNSUPPORTED_PLATFORM",
      message: `Updates are not available for architecture ${architecture}.`,
      hint: "Reinstall naps-cli manually for a supported platform.",
    });
  }
  if (platform === "darwin" || platform === "linux") return `naps-cli-${platform}-${arch}`;
  if (platform === "win32" && arch === "x64") return "naps-cli-windows-x64.exe";
  throw new UpdateError({
    code: "UPDATE_UNSUPPORTED_PLATFORM",
    message: `Updates are not available for ${platform}-${architecture}.`,
    hint: "Reinstall naps-cli manually for a supported platform.",
  });
};

const sha256 = ({ bytes }: { bytes: Uint8Array }) =>
  createHash("sha256").update(bytes).digest("hex");

const fetchRequired = async ({
  url,
  fetcher,
  signal,
}: {
  url: string;
  fetcher: typeof fetch;
  signal: AbortSignal;
}) => {
  let response: Response;
  try {
    response = await fetcher(url, { cache: "no-store", signal });
  } catch {
    throw new UpdateError({
      code: "UPDATE_DOWNLOAD_FAILED",
      message: "Could not download the update.",
      hint: "Check your internet connection and try again.",
    });
  }
  if (!response.ok) {
    throw new UpdateError({
      code: "UPDATE_DOWNLOAD_FAILED",
      message: `Could not download the update (${response.status}).`,
      hint: "Try again later.",
    });
  }
  return response;
};

const downloadBinary = async ({
  baseUrl,
  version,
  binaryName,
  fetcher,
  signal,
  signingPublicKey = RELEASE_PUBLIC_KEY,
}: {
  baseUrl: string;
  version: string;
  binaryName: string;
  fetcher: typeof fetch;
  signal: AbortSignal;
  signingPublicKey?: string;
}) => {
  const binaryUrl = `${baseUrl}/cli/${version}/${binaryName}`;
  const checksumResponse = await fetchRequired({
    url: `${binaryUrl}.sha256`,
    fetcher,
    signal,
  });
  const checksum = await checksumResponse.text();
  const checksumSignature = await fetchRequired({
    url: `${binaryUrl}.sha256.sig`,
    fetcher,
    signal,
  });
  if (
    !(await verifyReleaseSignature({
      content: new TextEncoder().encode(checksum),
      signature: await checksumSignature.text(),
      publicKey: signingPublicKey,
    }))
  ) {
    throw new UpdateError({
      code: "UPDATE_VERIFICATION_FAILED",
      message: "The update checksum signature is invalid.",
      hint: "Try again later. Do not install the downloaded update manually.",
    });
  }
  const checksumParts = checksum.trim().split(/\s+/);
  const expected = checksumParts[0]?.toLowerCase();
  if (checksumParts.length !== 2 || checksumParts[1] !== `cli/${version}/${binaryName}`) {
    throw new UpdateError({
      code: "UPDATE_VERIFICATION_FAILED",
      message: "The signed update checksum does not match this release.",
      hint: "Try again later. Do not install the downloaded update manually.",
    });
  }
  if (!expected || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new UpdateError({
      code: "UPDATE_VERIFICATION_FAILED",
      message: "The update checksum is invalid.",
      hint: "Try again later. Do not install the downloaded update manually.",
    });
  }

  let bytes: Uint8Array | undefined;
  let source: "gzip" | "raw" = "gzip";
  try {
    const compressedResponse = await fetchRequired({
      url: `${binaryUrl}.gz`,
      fetcher,
      signal,
    });
    bytes = gunzipSync(new Uint8Array(await compressedResponse.arrayBuffer()));
  } catch {
    source = "raw";
    const rawResponse = await fetchRequired({ url: binaryUrl, fetcher, signal });
    bytes = new Uint8Array(await rawResponse.arrayBuffer());
  }

  const actual = sha256({ bytes });
  if (actual !== expected) {
    throw new UpdateError({
      code: "UPDATE_VERIFICATION_FAILED",
      message: "The downloaded update failed verification.",
      hint: "Try again later. Do not install the downloaded update manually.",
    });
  }
  return { bytes, source };
};

const installPosixBinary = async ({
  executablePath,
  bytes,
}: {
  executablePath: string;
  bytes: Uint8Array;
}) => {
  const resolvedPath = await realpath(executablePath);
  if (basename(resolvedPath) !== "naps-cli") {
    throw new UpdateError({
      code: "UPDATE_INSTALL_FAILED",
      message: "Self-update is only available from an installed naps-cli binary.",
      hint: "Re-run the naps-cli installer instead.",
    });
  }
  await access(dirname(resolvedPath), constants.W_OK);
  const temporaryPath = join(
    dirname(resolvedPath),
    `.naps-cli-update-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  try {
    await writeFile(temporaryPath, bytes, { mode: 0o755 });
    await chmod(temporaryPath, 0o755);
    await rename(temporaryPath, resolvedPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
};

const updateCli = async ({
  currentVersion,
  env,
  executablePath,
  platform,
  architecture,
  fetch: injectedFetch,
  signingPublicKey = RELEASE_PUBLIC_KEY,
  onProgress,
}: UpdateOptions): Promise<UpdateResult> => {
  const fetcher = injectedFetch ?? fetch;
  const baseUrl = (env.NAPS_CLI_BASE || DEFAULT_BASE_URL).replace(/\/$/, "");
  const signal = AbortSignal.timeout(120_000);
  onProgress?.("Checking for updates...");
  const manifestResponse = await fetchRequired({
    url: `${baseUrl}/versions.json`,
    fetcher,
    signal,
  });
  const manifestText = await manifestResponse.text();
  const manifestSignatureResponse = await fetchRequired({
    url: `${baseUrl}/versions.json.sig`,
    fetcher,
    signal,
  });
  if (
    !(await verifyReleaseSignature({
      content: new TextEncoder().encode(manifestText),
      signature: await manifestSignatureResponse.text(),
      publicKey: signingPublicKey,
    }))
  ) {
    throw new UpdateError({
      code: "UPDATE_VERIFICATION_FAILED",
      message: "The update manifest signature is invalid.",
      hint: "Try again later.",
    });
  }
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestText);
  } catch {
    throw new UpdateError({
      code: "UPDATE_MANIFEST_INVALID",
      message: "The update manifest is invalid.",
      hint: "Try again later.",
    });
  }
  const manifest = parseVersionsManifest({ value: manifestValue });
  const comparison = compareVersions({ left: currentVersion, right: manifest.latest });
  if (comparison === 0) return { status: "current", latestVersion: manifest.latest };
  if (comparison > 0) return { status: "newer", latestVersion: manifest.latest };

  if (platform === "win32") {
    return {
      status: "windows",
      latestVersion: manifest.latest,
      installCommand:
        "iwr -useb https://raw.githubusercontent.com/JustinyAhin/naps-cli/main/install.ps1 | iex",
    };
  }

  let resolvedExecutablePath: string;
  try {
    resolvedExecutablePath = await realpath(executablePath);
  } catch {
    throw new UpdateError({
      code: "UPDATE_INSTALL_FAILED",
      message: "The installed naps-cli executable could not be located.",
      hint: "Re-run the naps-cli installer instead.",
    });
  }
  if (basename(resolvedExecutablePath) !== "naps-cli") {
    throw new UpdateError({
      code: "UPDATE_INSTALL_FAILED",
      message: "Self-update is only available from an installed naps-cli binary.",
      hint: "Re-run the naps-cli installer instead.",
    });
  }
  const binaryName = getBinaryName({ platform, architecture });
  onProgress?.(`Downloading ${manifest.latest}...`);
  const download = await downloadBinary({
    baseUrl,
    version: manifest.latest,
    binaryName,
    fetcher,
    signal,
    signingPublicKey,
  });
  onProgress?.("Installing update...");
  try {
    await installPosixBinary({ executablePath: resolvedExecutablePath, bytes: download.bytes });
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    throw new UpdateError({
      code: "UPDATE_INSTALL_FAILED",
      message: "The update could not be installed.",
      hint: "Check file permissions or re-run the naps-cli installer.",
    });
  }
  return { status: "updated", latestVersion: manifest.latest, source: download.source };
};

export {
  UpdateError,
  compareVersions,
  downloadBinary,
  getBinaryName,
  installPosixBinary,
  parseVersionsManifest,
  updateCli,
};
export type { UpdateErrorCode, UpdateOptions, UpdateResult, VersionsManifest };
