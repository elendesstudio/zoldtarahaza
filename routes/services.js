const express = require("express");
const router = express.Router();
const db = require("../db/database");

// GET /api/services
router.get("/", (req, res) => {
  db.all("SELECT id, name, duration_minutes FROM services", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: "Adatbázis hiba" });
    }

    res.json(rows);
  });
});

module.exports = router;