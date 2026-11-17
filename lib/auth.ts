import { betterAuth } from "better-auth";
import { pool } from "./db";

const hasGoogleOAuth = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

const appUrl = process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, "");

export const auth = betterAuth({
  database: pool,
  ...(appUrl
    ? {
        baseURL: appUrl,
        trustedOrigins: [appUrl],
      }
    : {}),
  emailAndPassword: {
    enabled: true,
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
    },
  },
  ...(hasGoogleOAuth
    ? {
        socialProviders: {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          },
        },
      }
    : {}),
});