const express = require('express');
const db = require('./db');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-this-secret';
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
    const { email, password } = req.body;
    db.get(`SELECT u.id, u.name, u.role, u.email, u.password_hash, tm.team_id, t.name AS team_name, t.club
        FROM users u LEFT JOIN team_members tm ON tm.user_id = u.id LEFT JOIN teams t ON t.id = tm.team_id
        WHERE u.email = ? LIMIT 1`, [email], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user || !user.password_hash || !bcrypt.compareSync(password || '', user.password_hash)) {
            return res.status(401).json({ error: 'E-mailadres of wachtwoord is onjuist.' });
        }
        const token = jwt.sign({ id: user.id, role: user.role, teamId: user.team_id }, JWT_SECRET, { expiresIn: '8h' });
        delete user.password_hash;
        res.json({ token, user });
    });
});

const authenticate = (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Aanmelden vereist.' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Sessie verlopen. Meld opnieuw aan.' });
    }
};

const allow = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Je hebt hiervoor geen rechten.' });
    next();
};

app.use('/api', authenticate);

// Haal alle spelers op
app.get('/api/players', (req, res) => {
    sendQuery(`SELECT u.id, u.name, u.role, u.email, u.exclude_driving, u.exclude_flagging
        FROM users u JOIN team_members tm ON tm.user_id = u.id WHERE tm.team_id = ? AND u.role = 'player' ORDER BY u.name`, [req.user.teamId], res);
});

// Voeg een nieuwe speler toe
// Voeg een nieuwe speler toe
app.post('/api/players', allow('admin', 'team-manager'), (req, res) => {
    const { name, email } = req.body;
    db.run('INSERT INTO users (name, role, email, password_hash) VALUES (?, ?, ?, ?)', [name, 'player', email || null, bcrypt.hashSync('voetbal123', 10)], function(err) {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        db.run('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)', [req.user.teamId, this.lastID], () => {
            res.json({ id: this.lastID, name, role: 'player' });
        });
    });
});

app.get('/api/events', (req, res) => {
    const allowedRoles = ['admin', 'team-manager', 'trainer', 'player', 'guardian'];
    if (!allowedRoles.includes(req.user.role)) return res.status(403).json({ error: 'Je hebt hiervoor geen rechten.' });
    const isTrainer = req.user.role === 'trainer';
    const typeFilter = isTrainer ? "AND e.type = 'training'" : '';
    return sendQuery(`SELECT e.*, COALESCE(SUM(a.status = 'present'), 0) AS present,
        (SELECT COUNT(*) FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ? AND u.role = 'player') AS total FROM events e
        LEFT JOIN attendance a ON a.event_id = e.id WHERE e.team_id = ? ${typeFilter} GROUP BY e.id ORDER BY e.date`, [req.user.teamId, req.user.teamId], res);
});

app.get('/api/attendance/:eventId', (req, res) => {
    const { eventId } = req.params;
    const allowedRoles = ['admin', 'team-manager', 'trainer'];
    if (!allowedRoles.includes(req.user.role)) {
        return sendQuery(`SELECT a.*, u.id AS user_id, u.name, u.role
            FROM attendance a JOIN users u ON u.id = a.user_id
            WHERE a.event_id = ? AND u.id = ? AND u.role = 'player' ORDER BY u.name`, [eventId, req.user.id], res);
    }
    return sendQuery(`SELECT a.*, u.id AS user_id, u.name, u.role
        FROM attendance a JOIN users u ON u.id = a.user_id
        WHERE a.event_id = ? AND u.role = 'player' ORDER BY u.name`, [eventId], res);
});

app.post('/api/attendance', (req, res) => {
    const { eventId, userId, status, note } = req.body;
    if (!['present', 'absent', 'maybe'].includes(status)) return res.status(400).json({ error: 'Ongeldige aanwezigheidsstatus.' });
    if (!['admin', 'team-manager', 'player', 'trainer'].includes(req.user.role)) return res.status(403).json({ error: 'Je kunt geen aanwezigheid wijzigen.' });
    const targetUserId = userId || req.user.id;
    if (req.user.role === 'player' && targetUserId !== req.user.id) return res.status(403).json({ error: 'Je kunt alleen je eigen antwoord wijzigen.' });
    db.run(`INSERT INTO attendance (event_id, user_id, status, note, responded_at) VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status, note = excluded.note, responded_at = datetime('now')`, [eventId, targetUserId, status, note || null], err => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ ok: true });
    });
});

app.get('/api/duties', (req, res) => sendQuery(`SELECT d.*, u.name, u.exclude_driving, u.exclude_flagging, e.title, e.date
    FROM duties d JOIN users u ON u.id = d.user_id JOIN events e ON e.id = d.event_id ORDER BY e.date`, [], res));

app.post('/api/duties/generate', allow('admin', 'team-manager'), (req, res) => {
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