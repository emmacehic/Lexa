import nodemailer from "nodemailer";

import { env, requireEnv } from "./env";

/** Magic-link mail. Nothing else is ever sent from here. */
export async function sendMagicLink(to: string, url: string): Promise<void> {
  const { SMTP_URL } = requireEnv("SMTP_URL");
  const transport = nodemailer.createTransport(SMTP_URL);
  const from = env().SMTP_FROM ?? `Lexa <no-reply@${new URL(SMTP_URL.replace(/^smtps?:/, "http:")).hostname}>`;

  await transport.sendMail({
    to,
    from,
    subject: "Your Lexa sign-in link",
    text: `Sign in to Lexa:\n\n${url}\n\nThe link works once and expires in 15 minutes.`,
    html: `<p>Sign in to Lexa:</p><p><a href="${url}">${url}</a></p><p>The link works once and expires in 15 minutes.</p>`,
  });
}
