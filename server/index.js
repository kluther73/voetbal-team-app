// Haal alle spelers op
app.get('/api/players', (req, res) => {
    db.all("SELECT * FROM users", [], (err, rows) => {
        if (err) {
            res.status(400).json({ "error": err.message });
            return;
        }
        res.json(rows);
    });
});

// Voeg een nieuwe speler toe
app.post('/api/players', (req, res) => {
    const { name } = req.body;
    db.run(`INSERT INTO users (name) VALUES (?)`, [name], function(err) {
        if (err) {
            res.status(400).json({ "error": err.message });
            return;
        }
        res.json({ id: this.lastID, name });
    });
});