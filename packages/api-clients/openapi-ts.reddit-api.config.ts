import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: process.env.REDDIT_API_OPENAPI_URL ?? "https://reddit-api.naps.sh/openapi.json",
  output: {
    path: "src/reddit-api",
    clean: true,
  },
  plugins: ["@hey-api/typescript", "@hey-api/sdk", "@hey-api/client-fetch"],
});
