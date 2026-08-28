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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is gestart op http://localhost:${PORT}`);
});