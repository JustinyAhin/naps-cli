import {
  createClient as createSeoApiSdkClient,
  createConfig as createSeoApiSdkConfig,
} from "api-clients/seo-api/client";
import type { GetLocationsData } from "api-clients/seo-api/types.gen";
import {
  createClient as createRedditApiSdkClient,
  createConfig as createRedditApiSdkConfig,
} from "api-clients/reddit-api/client";
import packageJson from "../package.json";
import { cliError } from "./cli/errors";

const optionalAuthToken = ({ envName }: { envName: string }): string | undefined => {
  const key = process.env[envName];
  return key || undefined;
};

const requiredAuthToken = ({
  code,
  envNames,
  serviceName,
}: {
  code: string;
  envNames: string[];
  serviceName: string;
}): string => {
  const key = envNames.map((envName) => process.env[envName]).find(Boolean);
  if (!key) {
    throw cliError({
      code,
      message: `${serviceName} authentication is not configured.`,
      hint: `Set ${envNames.join(" or ")} and try again.`,
    });
  }
  return key;
};

const seoApiClientHeaders = {
  "X-Naps-Client-Type": "cli",
  "X-Naps-Client-Name": "naps-cli",
  "X-Naps-Client-Version": packageJson.version,
} satisfies GetLocationsData["headers"];

let seoApiClient: ReturnType<typeof createSeoApiSdkClient> | undefined;
let redditApiClient: ReturnType<typeof createRedditApiSdkClient> | undefined;

const missingNapsApiKey = () =>
  cliError({
    code: "MISSING_NAPS_API_KEY",
    message: "A Naps API key is required for Reddit and SEO commands.",
    hint: "Request beta access and create a key at https://naps.sh/cli, then set NAPS_CLI_API_KEY.",
  });

const getSeoApiClient = () => {
  const publicKey = optionalAuthToken({ envName: "NAPS_CLI_API_KEY" });
  const internalKey =
    optionalAuthToken({ envName: "NAPS_CLI_SEO_API_TOKEN" }) ??
    optionalAuthToken({ envName: "SEO_API_TOKEN" });
  const key = publicKey ?? internalKey;
  if (!key) throw missingNapsApiKey();
  seoApiClient ??= createSeoApiSdkClient(
    createSeoApiSdkConfig({
      baseUrl: publicKey ? "https://naps.sh/api/cli/seo" : "https://seo-api.naps.sh/api",
      auth: key,
      headers: seoApiClientHeaders,
    }),
  );
  return seoApiClient;
};

const getRedditApiClient = () => {
  const publicKey = optionalAuthToken({ envName: "NAPS_CLI_API_KEY" });
  const internalKey = optionalAuthToken({ envName: "NAPS_CLI_REDDIT_API_TOKEN" });
  const key = publicKey ?? internalKey;
  if (!key) throw missingNapsApiKey();
  redditApiClient ??= createRedditApiSdkClient(
    createRedditApiSdkConfig({
      baseUrl: publicKey ? "https://naps.sh/api/cli" : "https://reddit-api.naps.sh",
      auth: key,
    }),
  );
  return redditApiClient;
};

const getTwitterApiToken = () =>
  requiredAuthToken({
    code: "MISSING_TWITTERAPI_TOKEN",
    envNames: ["NAPS_CLI_TWITTERAPI_TOKEN", "TWITTERAPI_API_KEY"],
    serviceName: "TwitterAPI.io",
  });

const getXBearerToken = () =>
  requiredAuthToken({
    code: "MISSING_X_API_TOKEN",
    envNames: ["NAPS_CLI_X_BEARER_TOKEN", "X_BEARER_TOKEN"],
    serviceName: "X API",
  });

const truncate = ({ value, max }: { value: string | null | undefined; max: number }) =>
  value ? (value.length > max ? value.slice(0, max) : value) : "";

export {
  getSeoApiClient,
  getRedditApiClient,
  getTwitterApiToken,
  getXBearerToken,
  seoApiClientHeaders,
  truncate,
};
