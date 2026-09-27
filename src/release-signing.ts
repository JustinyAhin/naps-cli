import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RELEASE_PUBLIC_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKvcoC1ojFcGh+fzVtMltG3VlFWikCW4POQin+jvuMCu";
const RELEASE_NAMESPACE = "naps-cli-release";

const verifyReleaseSignature = async ({
  content,
  signature,
  publicKey = RELEASE_PUBLIC_KEY,
}: {
  content: Uint8Array;
  signature: string;
  publicKey?: string;
}) => {
  if (signature.length > 4096 || !signature.startsWith("-----BEGIN SSH SIGNATURE-----")) {
    return false;
  }
  const directory = await mkdtemp(join(tmpdir(), "naps-cli-signature-"));
  try {
    const allowedSigners = join(directory, "allowed_signers");
    const signaturePath = join(directory, "release.sig");
    await writeFile(allowedSigners, `naps-cli ${publicKey}\n`, { mode: 0o600 });
    await writeFile(signaturePath, signature, { mode: 0o600 });
    const result = spawnSync(
      "ssh-keygen",
      [
        "-Y",
        "verify",
        "-f",
        allowedSigners,
        "-I",
        "naps-cli",
        "-n",
        RELEASE_NAMESPACE,
        "-s",
        signaturePath,
      ],
      { input: Buffer.from(content), stdio: ["pipe", "ignore", "ignore"] },
    );
    return result.status === 0;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

export { RELEASE_NAMESPACE, RELEASE_PUBLIC_KEY, verifyReleaseSignature };
