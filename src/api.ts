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

const getSeoApiClient = () => {
  seoApiClient ??= createSeoApiSdkClient(
    createSeoApiSdkConfig({
      baseUrl: "https://seo-api.naps.sh/api",
      auth: requiredAuthToken({
        code: "MISSING_SEO_API_TOKEN",
        envNames: ["NAPS_CLI_SEO_API_TOKEN", "SEO_API_TOKEN"],
        serviceName: "SEO API",
      }),
      headers: seoApiClientHeaders,
    }),
  );
  return seoApiClient;
};

const getRedditApiClient = () => {
  redditApiClient ??= createRedditApiSdkClient(
    createRedditApiSdkConfig({
      baseUrl: "https://reddit-api.naps.sh",
      auth: optionalAuthToken({ envName: "NAPS_CLI_REDDIT_API_TOKEN" }),
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
