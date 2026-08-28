const express = require('express');
const db = require('./db'); // Dit start je database op
const app = express();

app.use(express.json());
app.use(express.static('public'));

app.get('/api/status', (req, res) => {
    res.json({ status: "De voetbal app server draait!" });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server draait op http://localhost:${PORT}`);
});