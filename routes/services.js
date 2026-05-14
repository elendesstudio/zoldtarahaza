const express = require("express");
const router = express.Router();
const pg = require("../db/postgres");

// GET /api/services
router.get("/", async (req, res) => {
  try {
    const result = await pg.query(`
      SELECT id, name, duration_minutes, sort_order
      FROM services
      ORDER BY
        sort_order ASC NULLS LAST,
        id ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("PUBLIC SERVICES ERROR:", err);
    res.status(500).json({ error: "Adatbázis hiba" });
  }
});

module.exports = router;