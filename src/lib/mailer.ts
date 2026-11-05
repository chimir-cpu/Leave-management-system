import nodemailer from "nodemailer";

export function createTransporter() {
  // Local development: don't send real emails
  if (process.env.DISABLE_EMAIL === "true") {
    return nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  // Production: send real emails
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
}