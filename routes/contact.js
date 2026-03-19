const express = require("express");
const router = express.Router();
const { sendMail } = require("../utils/mailer");

function isValidEmail(email) {
  return typeof email === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post("/", async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: "Hiányzó mezők" });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Hibás email formátum" });
  }

  const adminText = `
Új üzenet érkezett a kapcsolat űrlapról

Név: ${name}
Email: ${email}

Üzenet:
${message}
`;

  try {
    // ===== ADMIN EMAIL =====
    await sendMail({
      to: process.env.OWNER_EMAIL,
      subject: "Új kapcsolat üzenet",
      text: adminText,
    });

    // ===== USER VISSZAIGAZOLÓ EMAIL =====
    const userHtml = `
<div style="margin:0;padding:0;background:#e9f3ef;padding:60px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center">
        <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.08);">

          <tr>
            <td style="background:linear-gradient(135deg,#0f3f2f 0%,#1e5a45 100%);padding:50px 40px;text-align:center;color:#ffffff;">
              <div style="font-size:14px;letter-spacing:3px;text-transform:uppercase;opacity:0.8;">
                Üzenet megérkezett
              </div>
              <h1 style="margin:15px 0 0 0;font-size:26px;font-weight:500;">
                Zöld Tara háza
              </h1>
            </td>
          </tr>

          <tr>
            <td style="padding:50px;color:#2f3e38;">
              <h2 style="margin:0 0 20px 0;font-size:22px;font-weight:500;color:#0f3f2f;">
                Kedves ${name},
              </h2>

              <p style="font-size:16px;line-height:1.7;margin-bottom:25px;">
                Köszönöm az üzeneted. Megérkezett hozzám, és rövidesen válaszolok.
              </p>

              <div style="background:#f5f9f7;border-radius:14px;padding:25px 30px;border:1px solid #e1ece7;">
                <div style="font-size:14px;color:#6b7d75;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">
                  Az általad küldött üzenet
                </div>
                <div style="font-size:15px;line-height:1.7;">
                  ${message.replace(/\n/g, "<br>")}
                </div>
              </div>

              <p style="margin-top:35px;font-size:15px;color:#5a6d65;">
                Szeretettel,<br>
                <strong style="color:#0f3f2f;">Zöld Tara háza</strong>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:25px 40px;text-align:center;font-size:12px;color:#8a9b93;background:#fafdfb;">
              © ${new Date().getFullYear()} Zöld Tara háza
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</div>
`;

    await sendMail({
      to: email,
      subject: "Üzeneted megérkezett – Zöld Tara háza",
      html: userHtml,
    });

    return res.json({ ok: true });

  } catch (err) {
    console.error("Contact email hiba:", err);
    return res.status(500).json({ error: "Email küldési hiba" });
  }
});

module.exports = router;