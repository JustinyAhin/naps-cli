import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ReleaseSigningKeyOptions<T> = {
  keyPath?: string;
  keyContent?: string;
  run: ({ signingKeyPath }: { signingKeyPath: string }) => Promise<T>;
};

const OPENSSH_PRIVATE_KEY =
  /^-----BEGIN OPENSSH PRIVATE KEY-----\n(?:[A-Za-z0-9+/=]+\n)+-----END OPENSSH PRIVATE KEY-----\n?$/u;

const withReleaseSigningKey = async <T>({
  keyPath,
  keyContent,
  run,
}: ReleaseSigningKeyOptions<T>): Promise<T> => {
  const hasPath = Boolean(keyPath?.trim());
  const hasContent = Boolean(keyContent?.trim());
  if (hasPath && hasContent) {
    throw new Error("Set only one of NAPS_CLI_SIGNING_KEY and NAPS_CLI_SIGNING_KEY_CONTENT.");
  }
  if (!hasPath && !hasContent) {
    throw new Error("NAPS_CLI_SIGNING_KEY or NAPS_CLI_SIGNING_KEY_CONTENT is required.");
  }
  if (hasPath) return run({ signingKeyPath: keyPath! });

  const normalizedContent = keyContent!.replaceAll("\r\n", "\n");
  if (!OPENSSH_PRIVATE_KEY.test(normalizedContent)) {
    throw new Error("NAPS_CLI_SIGNING_KEY_CONTENT must contain a complete OpenSSH private key.");
  }

  const directory = await mkdtemp(join(tmpdir(), "naps-release-signing-"));
  try {
    const signingKeyPath = join(directory, "signing-key");
    try {
      await chmod(directory, 0o700);
      await writeFile(signingKeyPath, `${normalizedContent.trimEnd()}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await chmod(signingKeyPath, 0o600);
    } catch {
      throw new Error("Could not prepare the temporary release signing key.");
    }
    return await run({ signingKeyPath });
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {
      throw new Error("Could not remove the temporary release signing key.");
    });
  }
};

export { withReleaseSigningKey };
