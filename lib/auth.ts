import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { pool } from "./db";

const allowedEmails = (process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

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
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (
            allowedEmails.length > 0 &&
            !allowedEmails.includes(user.email.toLowerCase())
          ) {
            throw new APIError("FORBIDDEN", {
              message:
                "Este correo no está autorizado para acceder a esta biblioteca privada.",
            });
          }
          return { data: user };
        },
      },
    },
  },
});