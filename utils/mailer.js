const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendMail({ to, subject, text, html }) {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.log("⚠️ No RESEND_API_KEY, email skipped");
      return;
    }

    console.log("📨 RESEND EMAIL:", to);

    const response = await resend.emails.send({
      from: "Zöld Tara háza <onboarding@resend.dev>",
      to,
      subject,
      html: html || `<p>${text}</p>`,
      reply_to: "zoldtarahaza@gmail.com",
    });

    console.log("✅ RESEND OK:", response);

    return response;

  } catch (err) {
    console.error("❌ EMAIL ERROR:", err.message);

    // 🔥 NE DŐLJÖN MEG A SZERVER
    return null;
  }
}

module.exports = { sendMail };