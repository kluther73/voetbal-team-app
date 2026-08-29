require('dotenv').config();
const express = require('express');
const db = require('./db');
const voetbalNl = require('./voetbalnl');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { encrypt, decrypt } = require('./secret');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-this-secret';
app.use(cors());
app.use(express.json());

const sendQuery = (sql, params, res) => db.all(sql, params, (err, rows) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json(rows);
});

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(err) {
    if (err) return reject(err);
    resolve(this);
}));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const rows = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, result) => err ? reject(err) : resolve(result)));

const field = (record, ...names) => names.map(name => record[name]).find(value => value !== undefined && value !== null && value !== '');
const isTrue = value => value === true || ['1', 'true', 'ja', 'yes', 'uit'].includes(String(value).toLowerCase());

const addAttendance = async (eventId, teamId) => {
    await run(`INSERT OR IGNORE INTO attendance (event_id, user_id, status, responded_at)
        SELECT ?, u.id, 'present', datetime('now')
        FROM users u JOIN team_members tm ON tm.user_id = u.id
        WHERE tm.team_id = ? AND u.role = 'player'`, [eventId, teamId]);
};

const importTeamData = async (teamId, payload) => {
    const summary = { players: 0, events: 0, otherFixtures: 0 };
    for (const sourcePlayer of payload.players || []) {
        const externalId = String(field(sourcePlayer, 'id', 'externalId', 'external_id', 'playerId') || '');
        const name = field(sourcePlayer, 'name', 'fullName', 'full_name');
        if (!externalId || !name) continue;
        const email = field(sourcePlayer, 'email', 'emailAddress', 'email_address') || null;
        let player = await get('SELECT id FROM users WHERE source_external_id = ? OR (email IS NOT NULL AND email = ?) LIMIT 1', [externalId, email]);
        if (player) {
            await run('UPDATE users SET name = ?, email = COALESCE(?, email), source_external_id = ? WHERE id = ?', [name, email, externalId, player.id]);
        } else {
            player = await run('INSERT INTO users (name, role, email, source_external_id, password_hash) VALUES (?, ?, ?, ?, ?)', [name, 'player', email, externalId, bcrypt.hashSync('voetbal123', 10)]);
        }
        await run('INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)', [teamId, player.id || player.lastID]);
        summary.players++;
    }
    for (const sourceEvent of payload.events || []) {
        const externalId = String(field(sourceEvent, 'id', 'externalId', 'external_id', 'eventId') || '');
        const type = field(sourceEvent, 'type', 'kind') === 'training' ? 'training' : 'match';
        const title = field(sourceEvent, 'title', 'name') || (type === 'training' ? 'Training' : 'Wedstrijd');
        const date = field(sourceEvent, 'date', 'startDate', 'start_date');
        if (!externalId || !date) continue;
        const values = [title, date, field(sourceEvent, 'time', 'startTime', 'start_time') || null, field(sourceEvent, 'location', 'venue') || null, field(sourceEvent, 'opponent', 'opponentName', 'opponent_name') || null, isTrue(field(sourceEvent, 'isAway', 'is_away', 'away')) ? 1 : 0, type, teamId, externalId];
        const existing = await get('SELECT id FROM events WHERE team_id = ? AND source_external_id = ?', [teamId, externalId]);
        if (existing) {
            await run('UPDATE events SET title = ?, date = ?, time = ?, location = ?, opponent = ?, is_away = ?, type = ? WHERE id = ?', [...values.slice(0, 7), existing.id]);
        } else {
            const created = await run('INSERT INTO events (title, date, time, location, opponent, is_away, type, team_id, source_external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', values);
            await addAttendance(created.lastID, teamId);
        }
        summary.events++;
    }
    for (const fixture of payload.otherFixtures || []) {
        const externalId = String(field(fixture, 'id', 'externalId', 'external_id', 'eventId') || '');
        const teamName = field(fixture, 'teamName', 'team_name', 'team') || 'Ander team';
        const date = field(fixture, 'date', 'startDate', 'start_date');
        if (!externalId || !date) continue;
        await run(`INSERT INTO external_fixtures (team_id, source_external_id, team_name, opponent, date, time, location, is_away)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(team_id, source_external_id) DO UPDATE SET team_name = excluded.team_name, opponent = excluded.opponent,
                date = excluded.date, time = excluded.time, location = excluded.location, is_away = excluded.is_away`,
        [teamId, externalId, teamName, field(fixture, 'opponent', 'opponentName', 'opponent_name') || null, date, field(fixture, 'time', 'startTime', 'start_time') || null, field(fixture, 'location', 'venue') || null, isTrue(field(fixture, 'isAway', 'is_away', 'away')) ? 1 : 0]);
        summary.otherFixtures++;
    }
    return summary;
};

const parseCsv = csv => {
    const lines = csv.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error('Het CSV-bestand bevat geen gegevens.');
    const parseLine = line => {
        const values = [];
        let value = '';
        let quoted = false;
        for (let index = 0; index < line.length; index++) {
            if (line[index] === '"') {
                if (quoted && line[index + 1] === '"') { value += '"'; index++; } else quoted = !quoted;
            } else if (line[index] === ',' && !quoted) { values.push(value.trim()); value = ''; } else value += line[index];
        }
        values.push(value.trim());
        return values;
    };
    const headers = parseLine(lines[0]).map(header => header.toLowerCase().replaceAll(' ', '_'));
    return lines.slice(1).map(line => Object.fromEntries(parseLine(line).map((value, index) => [headers[index], value])));
};

const integrationConfig = async teamId => {
    const config = await get('SELECT * FROM voetbalnl_integrations WHERE team_id = ?', [teamId]);
    return config ? { ...config, accessToken: decrypt(config.access_token_encrypted) } : null;
};

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

app.get('/api/admin/teams', allow('admin'), (req, res) => {
    sendQuery(`SELECT t.id, t.name, t.club, t.required_cars,
        (SELECT manager.name FROM users manager JOIN team_members tm ON tm.user_id = manager.id
            WHERE tm.team_id = t.id AND manager.role = 'team-manager' LIMIT 1) AS manager_name,
        (SELECT manager.email FROM users manager JOIN team_members tm ON tm.user_id = manager.id
            WHERE tm.team_id = t.id AND manager.role = 'team-manager' LIMIT 1) AS manager_email
        FROM teams t ORDER BY t.club, t.name`, [], res);
});

app.post('/api/admin/teams', allow('admin'), async (req, res) => {
    const { teamName, clubName, managerName, managerEmail, managerPassword } = req.body;
    if (![teamName, clubName, managerName, managerEmail, managerPassword].every(value => String(value || '').trim())) {
        return res.status(400).json({ error: 'Vul team, vereniging en gegevens van de team-manager in.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(managerEmail)) return res.status(400).json({ error: 'Vul een geldig e-mailadres in.' });
    if (String(managerPassword).length < 8) return res.status(400).json({ error: 'Het wachtwoord moet minimaal 8 tekens hebben.' });
    try {
        const duplicateTeam = await get('SELECT id FROM teams WHERE name = ? AND club = ?', [teamName.trim(), clubName.trim()]);
        if (duplicateTeam) return res.status(400).json({ error: 'Dit team bestaat al binnen de vereniging.' });
        let manager = await get('SELECT id, role FROM users WHERE email = ?', [managerEmail.trim().toLowerCase()]);
        if (manager && manager.role !== 'team-manager') return res.status(400).json({ error: 'Dit e-mailadres hoort al bij een andere rol.' });
        if (manager) {
            const existingMembership = await get('SELECT team_id FROM team_members WHERE user_id = ?', [manager.id]);
            if (existingMembership) return res.status(400).json({ error: 'Deze team-manager is al aan een team gekoppeld.' });
            await run('UPDATE users SET name = ?, password_hash = ? WHERE id = ?', [managerName.trim(), bcrypt.hashSync(managerPassword, 10), manager.id]);
        } else {
            const created = await run('INSERT INTO users (name, role, email, password_hash) VALUES (?, ?, ?, ?)', [managerName.trim(), 'team-manager', managerEmail.trim().toLowerCase(), bcrypt.hashSync(managerPassword, 10)]);
            manager = { id: created.lastID };
        }
        const team = await run('INSERT INTO teams (name, club) VALUES (?, ?)', [teamName.trim(), clubName.trim()]);
        await run('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)', [team.lastID, manager.id]);
        res.status(201).json({ id: team.lastID, name: teamName.trim(), club: clubName.trim(), managerName: managerName.trim(), managerEmail: managerEmail.trim().toLowerCase() });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Team aanmaken mislukt.' });
    }
});

app.get('/api/team-members', allow('team-manager'), (req, res) => {
    sendQuery(`SELECT u.id, u.name, u.email, u.role, gp.player_id, player.name AS player_name
        FROM users u
        JOIN team_members tm ON tm.user_id = u.id
        LEFT JOIN guardian_players gp ON gp.guardian_id = u.id
        LEFT JOIN users player ON player.id = gp.player_id
        WHERE tm.team_id = ? AND u.role IN ('player', 'guardian', 'trainer')
        ORDER BY CASE u.role WHEN 'player' THEN 1 WHEN 'guardian' THEN 2 ELSE 3 END, u.name`, [req.user.teamId], res);
});

app.post('/api/team-members', allow('team-manager'), async (req, res) => {
    const { name, email, role, password, playerId } = req.body;
    if (!['player', 'guardian', 'trainer'].includes(role)) return res.status(400).json({ error: 'Kies een geldige rol.' });
    if (![name, email, password].every(value => String(value || '').trim())) return res.status(400).json({ error: 'Vul naam, e-mailadres en tijdelijk wachtwoord in.' });
    if (!/^\S+@\S+\.\S+$/.test(email) || String(password).length < 8) return res.status(400).json({ error: 'Vul een geldig e-mailadres en een wachtwoord van minimaal 8 tekens in.' });
    try {
        if (role === 'guardian') {
            const player = await get(`SELECT u.id FROM users u JOIN team_members tm ON tm.user_id = u.id
                WHERE u.id = ? AND tm.team_id = ? AND u.role = 'player'`, [playerId, req.user.teamId]);
            if (!player) return res.status(400).json({ error: 'Kies een speler voor deze ouder/verzorger.' });
        }
        const existing = await get('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()]);
        if (existing) return res.status(400).json({ error: 'Dit e-mailadres is al in gebruik.' });
        const member = await run('INSERT INTO users (name, role, email, password_hash) VALUES (?, ?, ?, ?)', [name.trim(), role, email.trim().toLowerCase(), bcrypt.hashSync(password, 10)]);
        await run('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)', [req.user.teamId, member.lastID]);
        if (role === 'guardian') await run('INSERT INTO guardian_players (guardian_id, player_id) VALUES (?, ?)', [member.lastID, playerId]);
        res.status(201).json({ id: member.lastID });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Teamlid toevoegen mislukt.' });
    }
});

app.put('/api/team-members/:memberId', allow('team-manager'), async (req, res) => {
    const memberId = Number(req.params.memberId);
    const { name, email, playerId } = req.body;
    try {
        const member = await get(`SELECT u.id, u.role FROM users u JOIN team_members tm ON tm.user_id = u.id
            WHERE u.id = ? AND tm.team_id = ? AND u.role IN ('player', 'guardian', 'trainer')`, [memberId, req.user.teamId]);
        if (!member || !String(name || '').trim() || !/^\S+@\S+\.\S+$/.test(email || '')) return res.status(400).json({ error: 'Vul een geldige naam en e-mailadres in.' });
        const duplicate = await get('SELECT id FROM users WHERE email = ? AND id != ?', [email.trim().toLowerCase(), memberId]);
        if (duplicate) return res.status(400).json({ error: 'Dit e-mailadres is al in gebruik.' });
        if (member.role === 'guardian') {
            const player = await get(`SELECT u.id FROM users u JOIN team_members tm ON tm.user_id = u.id
                WHERE u.id = ? AND tm.team_id = ? AND u.role = 'player'`, [playerId, req.user.teamId]);
            if (!player) return res.status(400).json({ error: 'Kies een speler voor deze ouder/verzorger.' });
            await run('DELETE FROM guardian_players WHERE guardian_id = ?', [memberId]);
            await run('INSERT INTO guardian_players (guardian_id, player_id) VALUES (?, ?)', [memberId, playerId]);
        }
        await run('UPDATE users SET name = ?, email = ? WHERE id = ?', [name.trim(), email.trim().toLowerCase(), memberId]);
        res.json({ ok: true });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Teamlid wijzigen mislukt.' });
    }
});

app.delete('/api/team-members/:memberId', allow('team-manager'), async (req, res) => {
    const memberId = Number(req.params.memberId);
    try {
        const member = await get(`SELECT u.id FROM users u JOIN team_members tm ON tm.user_id = u.id
            WHERE u.id = ? AND tm.team_id = ? AND u.role IN ('player', 'guardian', 'trainer')`, [memberId, req.user.teamId]);
        if (!member) return res.status(404).json({ error: 'Teamlid niet gevonden.' });
        await run('DELETE FROM guardian_players WHERE guardian_id = ? OR player_id = ?', [memberId, memberId]);
        await run('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [req.user.teamId, memberId]);
        await run('DELETE FROM users WHERE id = ?', [memberId]);
        res.json({ ok: true });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Teamlid verwijderen mislukt.' });
    }
});

app.get('/api/integrations/voetbalnl', allow('team-manager'), (req, res) => {
    db.get(`SELECT t.name, t.club, integration.official_team_id, integration.matches_url, integration.trainings_url,
        integration.players_url, integration.other_fixtures_url, integration.access_token_encrypted
        FROM teams t LEFT JOIN voetbalnl_integrations integration ON integration.team_id = t.id WHERE t.id = ?`, [req.user.teamId], (err, settings) => {
        if (err || !settings) return res.status(404).json({ error: 'Team niet gevonden.' });
        res.json({
            name: settings.name,
            club: settings.club,
            officialTeamId: settings.official_team_id || '',
            matchesUrl: settings.matches_url || '',
            trainingsUrl: settings.trainings_url || '',
            playersUrl: settings.players_url || '',
            otherFixturesUrl: settings.other_fixtures_url || '',
            tokenConfigured: Boolean(settings.access_token_encrypted),
            configured: voetbalNl.configured({
                official_team_id: settings.official_team_id,
                matches_url: settings.matches_url,
                trainings_url: settings.trainings_url,
                players_url: settings.players_url
            })
        });
    });
});

app.post('/api/integrations/voetbalnl', allow('team-manager'), async (req, res) => {
    const { name, officialTeamId, matchesUrl, trainingsUrl, playersUrl, otherFixturesUrl, accessToken } = req.body;
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Vul een teamnaam in.' });
    const urls = [matchesUrl, trainingsUrl, playersUrl, otherFixturesUrl].filter(Boolean);
    if (urls.some(url => !/^https:\/\//i.test(url))) return res.status(400).json({ error: 'Gebruik een volledige https URL voor ieder endpoint.' });
    try {
        const existing = await get('SELECT access_token_encrypted FROM voetbalnl_integrations WHERE team_id = ?', [req.user.teamId]);
        const encryptedToken = accessToken ? encrypt(accessToken) : existing?.access_token_encrypted || null;
        await run('UPDATE teams SET name = ? WHERE id = ?', [name.trim(), req.user.teamId]);
        await run(`INSERT INTO voetbalnl_integrations (team_id, official_team_id, matches_url, trainings_url, players_url, other_fixtures_url, access_token_encrypted, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(team_id) DO UPDATE SET official_team_id = excluded.official_team_id, matches_url = excluded.matches_url,
                trainings_url = excluded.trainings_url, players_url = excluded.players_url, other_fixtures_url = excluded.other_fixtures_url,
                access_token_encrypted = excluded.access_token_encrypted, updated_at = excluded.updated_at`,
        [req.user.teamId, officialTeamId || null, matchesUrl || null, trainingsUrl || null, playersUrl || null, otherFixturesUrl || null, encryptedToken]);
        res.json({ ok: true });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Instellingen opslaan mislukt.' });
    }
});

app.post('/api/integrations/voetbalnl/sync', allow('team-manager'), async (req, res) => {
    try {
        const data = await voetbalNl.fetchTeamData(await integrationConfig(req.user.teamId));
        const summary = await importTeamData(req.user.teamId, {
            players: data.players,
            events: [...data.matches.map(match => ({ ...match, type: 'match' })), ...data.trainings.map(training => ({ ...training, type: 'training' }))],
            otherFixtures: data.otherFixtures
        });
        res.json(summary);
    } catch (error) {
        res.status(400).json({ error: error.message || 'Synchronisatie met voetbal.nl mislukt.' });
    }
});

app.post('/api/integrations/voetbalnl/csv', allow('team-manager'), async (req, res) => {
    try {
        const records = parseCsv(req.body.csv || '');
        const data = { players: [], events: [], otherFixtures: [] };
        records.forEach(record => {
            const type = String(field(record, 'record_type', 'type', 'kind') || '').toLowerCase();
            if (type === 'player' || type === 'speler') data.players.push(record);
            else if (type === 'training') data.events.push({ ...record, type: 'training' });
            else if (type === 'match' || type === 'wedstrijd') data.events.push({ ...record, type: 'match' });
            else if (type === 'other-match' || type === 'andere-wedstrijd') data.otherFixtures.push(record);
        });
        const summary = await importTeamData(req.user.teamId, data);
        res.json(summary);
    } catch (error) {
        res.status(400).json({ error: error.message || 'CSV-import mislukt.' });
    }
});

app.get('/api/external-fixtures', (req, res) => {
    sendQuery('SELECT * FROM external_fixtures WHERE team_id = ? ORDER BY date, time', [req.user.teamId], res);
});

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
        COALESCE(SUM(a.status = 'absent'), 0) AS absent,
        COALESCE(SUM(a.status = 'maybe'), 0) AS maybe,
        (SELECT COUNT(*) FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ? AND u.role = 'player') AS total FROM events e
        LEFT JOIN attendance a ON a.event_id = e.id WHERE e.team_id = ? ${typeFilter} GROUP BY e.id ORDER BY e.date`, [req.user.teamId, req.user.teamId], res);
});

app.post('/api/events', allow('admin', 'team-manager'), (req, res) => {
    const { type, title, date, time, location, opponent, isAway } = req.body;
    if (!['training', 'match'].includes(type)) return res.status(400).json({ error: 'Ongeldig event type.' });
    db.run('INSERT INTO events (type, title, date, time, location, opponent, is_away, team_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [type, title, date, time || null, location || null, opponent || null, isAway ? 1 : 0, req.user.teamId], function(err) {
            if (err) return res.status(400).json({ error: err.message });
            const eventId = this.lastID;
            db.all('SELECT id FROM users WHERE role = ? AND id IN (SELECT user_id FROM team_members WHERE team_id = ?)',
                ['player', req.user.teamId], (playersErr, players) => {
                    if (playersErr) return res.status(400).json({ error: playersErr.message });
                    if (players.length === 0) return res.json({ id: eventId, type, title, date, time, location, opponent, team_id: req.user.teamId, present: 0, total: 0 });
                    const stmt = db.prepare('INSERT INTO attendance (event_id, user_id, status, responded_at) VALUES (?, ?, ?, datetime("now"))');
                    players.forEach(player => stmt.run([eventId, player.id, 'present']));
                    stmt.finalize(() => {
                        res.json({ id: eventId, type, title, date, time, location, opponent, team_id: req.user.teamId, present: players.length, total: players.length });
                    });
                }
            );
        }
    );
});

app.get('/api/attendance/:eventId', (req, res) => {
    const { eventId } = req.params;
    const allowedRoles = ['admin', 'team-manager', 'trainer'];
    if (!allowedRoles.includes(req.user.role)) {
        return sendQuery(`SELECT a.*, u.id AS user_id, u.name, u.role
            FROM attendance a JOIN users u ON u.id = a.user_id
            WHERE a.event_id = ? AND a.user_id = ? AND u.role = 'player' ORDER BY u.name`, [eventId, req.user.id], res);
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

const dutyQuery = `SELECT d.*, u.name AS player_name, g.name AS guardian_name, e.title, e.date
    FROM duties d
    JOIN users u ON u.id = d.user_id
    JOIN users g ON g.id = d.guardian_id
    JOIN events e ON e.id = d.event_id
    WHERE e.team_id = ?
    ORDER BY e.date, d.type`;

app.get('/api/duties', (req, res) => sendQuery(dutyQuery, [req.user.teamId], res));

app.get('/api/duty-options', allow('team-manager'), (req, res) => {
    sendQuery(`SELECT player.id AS player_id, player.name AS player_name, guardian.id AS guardian_id, guardian.name AS guardian_name
        FROM guardian_players gp
        JOIN users player ON player.id = gp.player_id
        JOIN users guardian ON guardian.id = gp.guardian_id
        JOIN team_members tm ON tm.user_id = player.id
        WHERE tm.team_id = ? AND player.role = 'player'
        ORDER BY player.name, guardian.name`, [req.user.teamId], res);
});

app.get('/api/team-settings', (req, res) => {
    db.get(`SELECT t.required_cars,
        (SELECT manager.name FROM users manager JOIN team_members tm ON tm.user_id = manager.id
            WHERE tm.team_id = t.id AND manager.role = 'team-manager' LIMIT 1) AS manager_name
        FROM teams t WHERE t.id = ?`, [req.user.teamId], (err, team) => {
        if (err || !team) return res.status(404).json({ error: 'Team niet gevonden.' });
        res.json(team);
    });
});

app.post('/api/team-settings', allow('team-manager'), (req, res) => {
    const requiredCars = Number(req.body.requiredCars);
    if (!Number.isInteger(requiredCars) || requiredCars < 2 || requiredCars > 12) {
        return res.status(400).json({ error: 'Kies tussen 2 en 12 auto’s.' });
    }
    db.run('UPDATE teams SET required_cars = ? WHERE id = ?', [requiredCars, req.user.teamId], err => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ requiredCars });
    });
});

app.post('/api/duties/generate', allow('team-manager'), (req, res) => {
    const { type, eventId } = req.body;
    if (!['driver', 'flagger'].includes(type)) return res.status(400).json({ error: 'Ongeldig taaktype.' });
    db.get('SELECT id, is_away FROM events WHERE id = ? AND team_id = ?', [eventId, req.user.teamId], (eventErr, event) => {
        if (eventErr || !event) return res.status(404).json({ error: 'Activiteit niet gevonden.' });
        if (type === 'driver' && !event.is_away) return res.status(400).json({ error: 'Een rijschema is alleen nodig voor uitwedstrijden.' });
        const selectAssignment = (excluded, excludedPlayerId, callback) => db.all(`SELECT player.id AS player_id, guardian.id AS guardian_id
            FROM users player
            JOIN team_members tm ON tm.user_id = player.id
            JOIN guardian_players gp ON gp.player_id = player.id
            JOIN users guardian ON guardian.id = gp.guardian_id
            WHERE tm.team_id = ? AND player.role = 'player' AND player.${excluded} = 0 ${excludedPlayerId ? 'AND player.id != ?' : ''}
            ORDER BY (SELECT COUNT(*) FROM duties previous JOIN events previous_event ON previous_event.id = previous.event_id
                WHERE previous.user_id = player.id AND previous.type = ? AND previous_event.team_id = ?), player.name, guardian.name
            LIMIT ?`, excludedPlayerId ? [req.user.teamId, excludedPlayerId, type, req.user.teamId, 12] : [req.user.teamId, type, req.user.teamId, 12], callback);
        const sendDuties = () => sendQuery(dutyQuery, [req.user.teamId], res);
        const saveFlagger = callback => {
            db.get('SELECT user_id AS player_id, guardian_id FROM duties WHERE event_id = ? AND type = ?', [eventId, 'flagger'], (flagErr, flagger) => {
                if (flagErr) return res.status(400).json({ error: flagErr.message });
                if (flagger) return callback(flagger);
                selectAssignment('exclude_flagging', null, (selectionErr, selections) => {
                    if (selectionErr || !selections.length) return res.status(400).json({ error: 'Geen beschikbare vlagger met ouder/verzorger.' });
                    const selected = selections[0];
                    db.run('INSERT INTO duties (event_id, user_id, guardian_id, type, note) VALUES (?, ?, ?, ?, ?)',
                        [eventId, selected.player_id, selected.guardian_id, 'flagger', 'Automatisch verdeeld'], insertErr => {
                            if (insertErr) return res.status(400).json({ error: insertErr.message });
                            callback(selected);
                        });
                });
            });
        };
        if (type === 'flagger') {
            db.run('DELETE FROM duties WHERE event_id = ? AND type = ?', [eventId, type], deleteErr => {
                if (deleteErr) return res.status(400).json({ error: deleteErr.message });
                saveFlagger(sendDuties);
            });
            return;
        }
        db.get('SELECT required_cars FROM teams WHERE id = ?', [req.user.teamId], (teamErr, team) => {
            if (teamErr || !team) return res.status(404).json({ error: 'Team niet gevonden.' });
            saveFlagger(flagger => {
                const additionalDrivers = Math.max(team.required_cars - 2, 0);
                selectAssignment('exclude_driving', flagger.player_id, (selectionErr, selections) => {
                    if (selectionErr) return res.status(400).json({ error: selectionErr.message });
                    db.run('DELETE FROM duties WHERE event_id = ? AND type = ?', [eventId, 'driver'], deleteErr => {
                        if (deleteErr) return res.status(400).json({ error: deleteErr.message });
                        const statement = db.prepare('INSERT INTO duties (event_id, user_id, guardian_id, type, note) VALUES (?, ?, ?, ?, ?)');
                        selections.slice(0, additionalDrivers).forEach(driver => statement.run([eventId, driver.player_id, driver.guardian_id, 'driver', 'Automatisch verdeeld']));
                        statement.finalize(finalizeErr => {
                            if (finalizeErr) return res.status(400).json({ error: finalizeErr.message });
                            sendDuties();
                        });
                    });
                });
            });
        });
    });
});

app.post('/api/duties', allow('team-manager'), (req, res) => {
    const { eventId, type, playerId, guardianId } = req.body;
    if (!['driver', 'flagger'].includes(type)) return res.status(400).json({ error: 'Ongeldig taaktype.' });
    if (type === 'driver') return res.status(400).json({ error: 'Gebruik automatisch verdelen voor het rijschema.' });
    const excluded = type === 'driver' ? 'exclude_driving' : 'exclude_flagging';
    db.get(`SELECT event.id
        FROM events event
        JOIN team_members tm ON tm.user_id = ? AND tm.team_id = event.team_id
        JOIN users player ON player.id = tm.user_id
        JOIN guardian_players gp ON gp.player_id = player.id AND gp.guardian_id = ?
        WHERE event.id = ? AND event.team_id = ? AND player.role = 'player' AND player.${excluded} = 0`,
    [playerId, guardianId, eventId, req.user.teamId], (err, eligibleAssignment) => {
        if (err || !eligibleAssignment) return res.status(400).json({ error: 'Deze ouder/verzorger kan deze taak niet uitvoeren.' });
        db.run('DELETE FROM duties WHERE event_id = ? AND type = ?', [eventId, type], deleteErr => {
            if (deleteErr) return res.status(400).json({ error: deleteErr.message });
            db.run('INSERT INTO duties (event_id, user_id, guardian_id, type, note) VALUES (?, ?, ?, ?, ?)',
                [eventId, playerId, guardianId, type, 'Handmatig ingedeeld'], insertErr => {
                    if (insertErr) return res.status(400).json({ error: insertErr.message });
                    sendQuery(dutyQuery, [req.user.teamId], res);
                });
        });
    });
});

const audienceRoles = audience => audience === 'players' ? ['player'] : audience === 'guardians' ? ['guardian'] : ['player', 'guardian'];

app.get('/api/surveys', (req, res) => {
    db.all(`SELECT s.*, COUNT(DISTINCT answer.user_id) AS responses,
        (SELECT COUNT(*) FROM team_members tm JOIN users recipient ON recipient.id = tm.user_id
            WHERE tm.team_id = s.team_id AND (
                (s.target_audience = 'players' AND recipient.role = 'player') OR
                (s.target_audience = 'guardians' AND recipient.role = 'guardian') OR
                (s.target_audience = 'both' AND recipient.role IN ('player', 'guardian'))
            )) AS total
        FROM surveys s LEFT JOIN survey_answers answer ON answer.survey_id = s.id
        WHERE s.team_id = ? AND s.status = 'open' GROUP BY s.id ORDER BY s.deadline`, [req.user.teamId], (err, surveys) => {
        if (err) return res.status(400).json({ error: err.message });
        const visible = req.user.role === 'team-manager' ? surveys : surveys.filter(survey => audienceRoles(survey.target_audience).includes(req.user.role));
        Promise.all(visible.map(async survey => ({
            ...survey,
            questions: await rows(`SELECT q.*, (SELECT COUNT(*) FROM survey_answers a WHERE a.question_id = q.id AND a.user_id = ?) AS answered
                FROM survey_questions q WHERE q.survey_id = ? ORDER BY q.id`, [req.user.id, survey.id])
        }))).then(async result => {
            for (const survey of result) {
                for (const question of survey.questions) question.options = await rows('SELECT id, label, position FROM survey_options WHERE question_id = ? ORDER BY position', [question.id]);
            }
            res.json(result);
        }).catch(error => res.status(400).json({ error: error.message }));
    });
});

app.post('/api/surveys', allow('team-manager'), async (req, res) => {
    const { title, deadline, targetAudience, selectionType, question, options } = req.body;
    if (!['players', 'guardians', 'both'].includes(targetAudience)) return res.status(400).json({ error: 'Kies een doelgroep.' });
    if (!['single', 'multiple'].includes(selectionType)) return res.status(400).json({ error: 'Kies een vraagtype.' });
    if (!deadline || !question || !Array.isArray(options) || options.length < 2 || options.some(option => !String(option).trim())) {
        return res.status(400).json({ error: 'Vul deadline, vraag en minstens twee antwoordopties in.' });
    }
    try {
        const survey = await run(`INSERT INTO surveys (question, title, deadline, team_id, target_audience, status)
            VALUES (?, ?, ?, ?, ?, 'open')`, [question.trim(), title?.trim() || question.trim(), deadline, req.user.teamId, targetAudience]);
        const createdQuestion = await run('INSERT INTO survey_questions (survey_id, question, selection_type) VALUES (?, ?, ?)', [survey.lastID, question.trim(), selectionType]);
        for (const [position, label] of options.map(option => option.trim()).entries()) {
            await run('INSERT INTO survey_options (question_id, label, position) VALUES (?, ?, ?)', [createdQuestion.lastID, label, position]);
        }
        res.json({ id: survey.lastID });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Enquête aanmaken mislukt.' });
    }
});

app.post('/api/surveys/:surveyId/answers', async (req, res) => {
    const surveyId = Number(req.params.surveyId);
    const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
    try {
        const survey = await get('SELECT * FROM surveys WHERE id = ? AND team_id = ? AND status = ?', [surveyId, req.user.teamId, 'open']);
        if (!survey || !audienceRoles(survey.target_audience).includes(req.user.role)) return res.status(403).json({ error: 'Deze enquête is niet voor jou beschikbaar.' });
        const questions = await rows('SELECT * FROM survey_questions WHERE survey_id = ?', [surveyId]);
        if (answers.length !== questions.length) return res.status(400).json({ error: 'Beantwoord iedere vraag.' });
        for (const question of questions) {
            const selection = answers.find(answer => Number(answer.questionId) === question.id)?.optionIds || [];
            if (!Array.isArray(selection) || !selection.length || (question.selection_type === 'single' && selection.length !== 1)) {
                return res.status(400).json({ error: 'Kies een geldig antwoord.' });
            }
            const validOptions = await rows(`SELECT id FROM survey_options WHERE question_id = ? AND id IN (${selection.map(() => '?').join(',')})`, [question.id, ...selection]);
            if (validOptions.length !== selection.length) return res.status(400).json({ error: 'Ongeldige antwoordoptie.' });
            await run('DELETE FROM survey_answers WHERE question_id = ? AND user_id = ?', [question.id, req.user.id]);
            for (const option of selection) await run('INSERT INTO survey_answers (survey_id, question_id, user_id, option_id) VALUES (?, ?, ?, ?)', [surveyId, question.id, req.user.id, option]);
        }
        res.json({ ok: true });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Antwoord opslaan mislukt.' });
    }
});

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