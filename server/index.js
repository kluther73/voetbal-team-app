const express = require('express');
const db = require('./db');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serveer de frontend bestanden uit de 'public' map
app.use(express.static(path.join(__dirname, '../public')));

// Test API endpoint
app.get('/api/status', (req, res) => {
    res.json({ message: "De server draait en de database is gekoppeld!" });
});

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is gestart op http://localhost:${PORT}`);
});