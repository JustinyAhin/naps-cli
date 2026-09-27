import packageJson from "../../package.json";
import type { CliContext } from "../cli/context";
import { cliError } from "../cli/errors";
import { UpdateError, updateCli } from "../update";

const command = async function (this: CliContext) {
  try {
    const result = await updateCli({
      currentVersion: packageJson.version,
      env: this.process.env,
      executablePath: this.runtime.executablePath,
      platform: this.runtime.platform,
      architecture: this.runtime.architecture,
      fetch: this.fetch,
      onProgress: (message) => this.process.stderr.write(`${message}\n`),
    });

    if (result.status === "current") {
      this.process.stdout.write(`naps-cli is already current (${result.latestVersion}).\n`);
    } else if (result.status === "newer") {
      this.process.stdout.write(
        `Installed version is newer than the latest release (${result.latestVersion}); nothing to do.\n`,
      );
    } else if (result.status === "windows") {
      this.process.stdout.write(
        `naps-cli ${result.latestVersion} is available. Update with:\n  ${result.installCommand}\n`,
      );
    } else {
      this.process.stdout.write(`Updated naps-cli to ${result.latestVersion}.\n`);
    }
  } catch (error) {
    if (error instanceof UpdateError) {
      return cliError({ code: error.code, message: error.message, hint: error.hint });
    }
    return cliError({
      code: "UPDATE_INSTALL_FAILED",
      message: "The update failed.",
      hint: "Try again. If the problem continues, re-run the naps-cli installer.",
    });
  }
};

export default command;
