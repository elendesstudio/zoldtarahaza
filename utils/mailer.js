const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendMail({ to, subject, text, html }) {
  console.log("📨 RESEND EMAIL:", to);

  const response = await resend.emails.send({
    from: "Zöld Tara háza <booking@zoldtarahaza.hu>",
    to,
    subject,
    html: html || `<p>${text}</p>`,
    reply_to: "zoldtarahaza@gmail.com",
  });

  console.log("✅ RESEND OK:", response);

  return response;
}

module.exports = { sendMail };