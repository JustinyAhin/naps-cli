type VersionsManifest = { latest: string; versions: string[] };

type UploadArtifact = {
  key: string;
  file: string;
  contentType?: string;
  size: number;
};

type TemporaryCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

const VERSION_PATTERN = /^v\d+\.\d+\.\d+$/;
const BRIDGE_VERSION = "v0.4.0";
const UPLOAD_CONCURRENCY = 3;
const MULTIPART_OPTIONS = {
  partSize: 8 * 1024 * 1024,
  queueSize: 4,
  retry: 3,
} as const;

const parseManifest = ({ value }: { value: unknown }): VersionsManifest => {
  if (!value || typeof value !== "object") throw new Error("versions.json is invalid");
  const candidate = value as Partial<VersionsManifest>;
  if (
    typeof candidate.latest !== "string" ||
    !VERSION_PATTERN.test(candidate.latest) ||
    !Array.isArray(candidate.versions) ||
    !candidate.versions.every(
      (releaseVersion) =>
        typeof releaseVersion === "string" && VERSION_PATTERN.test(releaseVersion),
    ) ||
    !candidate.versions.includes(candidate.latest)
  ) {
    throw new Error("versions.json is invalid");
  }
  return { latest: candidate.latest, versions: candidate.versions };
};

const compareVersions = ({ left, right }: { left: string; right: string }) => {
  const leftParts = left.slice(1).split(".").map(Number);
  const rightParts = right.slice(1).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
};

const parseJson = ({ output, label }: { output: string; label: string }): unknown => {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
};

const parseCfVersion = ({ output }: { output: string }) => {
  const match = output.match(/\bv?(\d+)\.(\d+)\.(\d+)\b/);
  if (!match) throw new Error("could not determine cf version");
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
};

const parseAccountId = ({ output, accountId }: { output: string; accountId?: string }) => {
  const configuredId = accountId?.trim();
  if (configuredId) {
    if (!/^[a-f0-9]{32}$/i.test(configuredId)) {
      throw new Error("CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account ID.");
    }
    return configuredId;
  }
  const value = parseJson({ output, label: "cf auth whoami" }) as {
    accounts?: Array<{ id?: string }>;
  };
  if (!Array.isArray(value.accounts) || value.accounts.length !== 1) {
    throw new Error(
      "Set CLOUDFLARE_ACCOUNT_ID when cf auth whoami does not return exactly one account.",
    );
  }
  const selectedId = value.accounts[0]?.id;
  if (typeof selectedId !== "string" || !/^[a-f0-9]{32}$/i.test(selectedId)) {
    throw new Error("cf auth whoami returned an invalid account ID.");
  }
  return selectedId;
};

const assertCfAuthenticated = ({ output }: { output: string }) => {
  const value = parseJson({ output, label: "cf auth whoami" }) as {
    authenticated?: boolean;
    tokenValid?: boolean;
  };
  if (value.authenticated !== true || value.tokenValid === false) {
    throw new Error("cf is not authenticated with a valid token; run cf auth login");
  }
};

const resolveCfAccountId = async ({
  hasApiToken,
  accountId,
  getWhoami,
}: {
  hasApiToken: boolean;
  accountId?: string;
  getWhoami: () => Promise<string>;
}) => {
  if (hasApiToken) {
    if (!accountId?.trim()) {
      throw new Error("CLOUDFLARE_ACCOUNT_ID is required with CLOUDFLARE_API_TOKEN.");
    }
    // Bucket-scoped R2 tokens can lack the user-profile access used by whoami.
    // The temporary-credentials request checks their R2 permissions before upload.
    return parseAccountId({ output: "", accountId });
  }
  const output = await getWhoami();
  assertCfAuthenticated({ output });
  return parseAccountId({ output, accountId });
};

const parseTemporaryCredentials = ({ output }: { output: string }): TemporaryCredentials => {
  const value = parseJson({ output, label: "cf temporary credentials" }) as Record<string, unknown>;
  const accessKeyId = value.accessKeyId ?? value.access_key_id;
  const secretAccessKey = value.secretAccessKey ?? value.secret_access_key;
  const sessionToken = value.sessionToken ?? value.session_token;
  if (
    typeof accessKeyId !== "string" ||
    typeof secretAccessKey !== "string" ||
    typeof sessionToken !== "string"
  ) {
    throw new Error("cf temporary credentials response is invalid");
  }
  return { accessKeyId, secretAccessKey, sessionToken };
};

const artifact = ({
  key,
  file,
  contentType,
}: {
  key: string;
  file: string;
  contentType?: string;
}): UploadArtifact => ({ key, file, contentType, size: Bun.file(file).size });

const buildBinaryUploadPlan = ({
  version,
  binaries,
  distDir,
}: {
  version: string;
  binaries: string[];
  distDir: string;
}) => {
  const uploads: UploadArtifact[] = [];
  const bridgeRelease = version === BRIDGE_VERSION;
  for (const binary of binaries) {
    const file = `${distDir}/${binary}`;
    if (bridgeRelease) {
      uploads.push(artifact({ key: `cli/${version}/${binary}`, file }));
    }
    uploads.push(
      artifact({
        key: `cli/${version}/${binary}.gz`,
        file: `${file}.gz`,
        contentType: "application/gzip",
      }),
      artifact({
        key: `cli/${version}/${binary}.sha256`,
        file: `${file}.sha256`,
        contentType: "text/plain",
      }),
      artifact({
        key: `cli/${version}/${binary}.sha256.sig`,
        file: `${file}.sha256.sig`,
        contentType: "text/plain",
      }),
    );
    if (bridgeRelease) {
      uploads.push(
        artifact({ key: `cli/latest/${binary}`, file }),
        artifact({
          key: `cli/latest/${binary}.sha256`,
          file: `${file}.sha256`,
          contentType: "text/plain",
        }),
      );
    }
  }
  return uploads;
};

const mapConcurrent = async <Input, Output>({
  values,
  concurrency,
  mapper,
}: {
  values: Input[];
  concurrency: number;
  mapper: (value: Input) => Promise<Output>;
}) => {
  const results = Array.from<Output>({ length: values.length });
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
};

const totalBytes = ({ artifacts }: { artifacts: UploadArtifact[] }) =>
  artifacts.reduce((sum, upload) => sum + upload.size, 0);

export {
  BRIDGE_VERSION,
  MULTIPART_OPTIONS,
  UPLOAD_CONCURRENCY,
  VERSION_PATTERN,
  artifact,
  assertCfAuthenticated,
  buildBinaryUploadPlan,
  compareVersions,
  mapConcurrent,
  parseAccountId,
  parseCfVersion,
  parseManifest,
  parseTemporaryCredentials,
  resolveCfAccountId,
  totalBytes,
};
export type { TemporaryCredentials, UploadArtifact, VersionsManifest };
