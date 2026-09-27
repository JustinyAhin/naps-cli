import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "https://seo-api.naps.sh/api/openapi",
  output: {
    path: "src/seo-api",
    clean: true,
  },
  plugins: ["@hey-api/typescript", "@hey-api/sdk", "@hey-api/client-fetch"],
});
