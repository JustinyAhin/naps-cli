import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ResolvedCredentials, SearchConsoleCredentials } from "./types";

type NapsConfig = {
  version: 1;
  searchConsole?: SearchConsoleCredentials;
};

class SearchConsoleConfigError extends Error {}

const getConfigPath = () => {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) {
      throw new SearchConsoleConfigError("APPDATA is not set; cannot locate the Naps config.");
    }
    return join(appData, "naps", "config.json");
  }

  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configHome, "naps", "config.json");
};

const readConfig = async ({
  path = getConfigPath(),
}: { path?: string } = {}): Promise<NapsConfig> => {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<NapsConfig>;
    if (parsed.version !== 1) {
      throw new SearchConsoleConfigError(`Unsupported Naps config version in ${path}.`);
    }
    return parsed as NapsConfig;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { version: 1 };
    }
    if (error instanceof SearchConsoleConfigError) {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw new SearchConsoleConfigError(`Invalid JSON in Naps config: ${path}.`);
    }
    throw error;
  }
};

const writeConfig = async ({
  config,
  path = getConfigPath(),
}: {
  config: NapsConfig;
  path?: string;
}) => {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    await chmod(directory, 0o700);
  }

  const temporaryPath = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, path);
  if (process.platform !== "win32") {
    await chmod(path, 0o600);
  }
};

const saveCredentials = async ({
  credentials,
  path,
}: {
  credentials: SearchConsoleCredentials;
  path?: string;
}) => {
  const config = await readConfig({ path });
  await writeConfig({ config: { ...config, searchConsole: credentials }, path });
};

const clearCredentials = async ({ path }: { path?: string } = {}) => {
  const config = await readConfig({ path });
  const { searchConsole: _, ...rest } = config;
  await writeConfig({ config: rest, path });
};

const resolveCredentials = async ({
  path,
  env = process.env,
}: {
  path?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<ResolvedCredentials | null> => {
  const environmentRefreshToken = env.NAPS_GSC_REFRESH_TOKEN;
  if (environmentRefreshToken) {
    return {
      source: "environment",
      credentials: {
        refreshToken: environmentRefreshToken,
        scope: ["https://www.googleapis.com/auth/webmasters.readonly"],
        connectedAt: "environment",
      },
    };
  }

  const config = await readConfig({ path });
  return config.searchConsole ? { source: "config", credentials: config.searchConsole } : null;
};

export {
  SearchConsoleConfigError,
  clearCredentials,
  getConfigPath,
  readConfig,
  resolveCredentials,
  saveCredentials,
};
