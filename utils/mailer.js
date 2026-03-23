const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // kötelező Gmailhez
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 5000, // 🔥 EZ A LÉNYEG
  greetingTimeout: 5000,
  socketTimeout: 5000,
});

async function sendMail({ to, subject, text, html }) {
  console.log("📨 EMAIL PRÓBA:", to);

  const info = await transporter.sendMail({
    from: `"Zöld Tara háza" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html,
  });

  console.log("✅ EMAIL SENT:", info.response);

  return info;
}

module.exports = {
  sendMail,
};