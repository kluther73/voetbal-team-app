const express = require('express');
const db = require('./db');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const sendQuery = (sql, params, res) => db.all(sql, params, (err, rows) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json(rows);
});

// Serveer de frontend bestanden uit de 'public' map
app.use(express.static(path.join(__dirname, '../public')));

// Test API endpoint
app.get('/api/status', (req, res) => {
    res.json({ message: 'De server draait en de database is gekoppeld!' });
});

app.post('/api/login', (req, res) => {
    const { email } = req.body;
    db.get('SELECT id, name, role, email FROM users WHERE email = ?', [email], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: 'Geen gebruiker gevonden.' });
        res.json({ user });
    });
});

// Haal alle spelers op
app.get('/api/players', (req, res) => {
    sendQuery('SELECT id, name, role, email, exclude_driving, exclude_flagging FROM users ORDER BY name', [], res);
});

// Voeg een nieuwe speler toe
// Voeg een nieuwe speler toe
app.post('/api/players', (req, res) => {
    const { name, email } = req.body;
    db.run('INSERT INTO users (name, role, email) VALUES (?, ?, ?)', [name, 'player', email || null], function(err) {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        res.json({ id: this.lastID, name, role: 'player' });
    });
});

app.get('/api/events', (req, res) => sendQuery(`SELECT e.*, COALESCE(SUM(a.status = 'present'), 0) AS present,
    (SELECT COUNT(*) FROM users WHERE role = 'player') AS total FROM events e
    LEFT JOIN attendance a ON a.event_id = e.id GROUP BY e.id ORDER BY e.date`, [], res));

app.post('/api/attendance', (req, res) => {
    const { eventId, userId, status } = req.body;
    db.run(`INSERT INTO attendance (event_id, user_id, status) VALUES (?, ?, ?)
        ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status`, [eventId, userId, status], err => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ ok: true });
    });
});

app.get('/api/duties', (req, res) => sendQuery(`SELECT d.*, u.name, u.exclude_driving, u.exclude_flagging, e.title, e.date
    FROM duties d JOIN users u ON u.id = d.user_id JOIN events e ON e.id = d.event_id ORDER BY e.date`, [], res));

app.post('/api/duties/generate', (req, res) => {
    const { type, eventId } = req.body;
    const excluded = type === 'driver' ? 'exclude_driving' : 'exclude_flagging';
    db.all(`SELECT id FROM users WHERE role = 'player' AND ${excluded} = 0 ORDER BY id`, [], (err, users) => {
        if (err || users.length === 0) return res.status(400).json({ error: 'Geen beschikbare spelers.' });
        db.get('SELECT COUNT(*) AS count FROM duties WHERE type = ?', [type], (countErr, row) => {
            if (countErr) return res.status(400).json({ error: countErr.message });
            const selected = users[row.count % users.length];
            db.run('INSERT OR REPLACE INTO duties (event_id, user_id, type, note) VALUES (?, ?, ?, ?)', [eventId, selected.id, type, 'Automatisch verdeeld'], err2 => {
                if (err2) return res.status(400).json({ error: err2.message });
                sendQuery(`SELECT d.*, u.name, u.exclude_driving, u.exclude_flagging, e.title, e.date
                    FROM duties d JOIN users u ON u.id = d.user_id JOIN events e ON e.id = d.event_id ORDER BY e.date`, [], res);
            });
        });
    });
});

app.get('/api/surveys', (req, res) => sendQuery('SELECT * FROM surveys ORDER BY deadline', [], res));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`Server is gestart op http://localhost:${PORT}`);
});

server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Poort ${PORT} is al in gebruik. Stop de bestaande server of start met PORT=3001 npm start.`);
        process.exitCode = 1;
        return;
    }
    throw error;
});