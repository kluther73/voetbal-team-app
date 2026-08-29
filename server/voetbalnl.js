const replaceTeamId = value => value.replaceAll('{teamId}', encodeURIComponent(process.env.VOETBAL_NL_TEAM_ID || ''));

const getCollection = async url => {
    const response = await fetch(replaceTeamId(url), {
        headers: {
            Accept: 'application/json',
            ...(process.env.VOETBAL_NL_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.VOETBAL_NL_ACCESS_TOKEN}` } : {})
        }
    });
    if (!response.ok) throw new Error(`voetbal.nl gaf HTTP ${response.status}.`);
    const payload = await response.json();
    return Array.isArray(payload) ? payload : payload.data || payload.items || [];
};

const configured = () => Boolean(
    process.env.VOETBAL_NL_TEAM_ID &&
    process.env.VOETBAL_NL_MATCHES_URL &&
    process.env.VOETBAL_NL_TRAININGS_URL &&
    process.env.VOETBAL_NL_PLAYERS_URL
);

const fetchTeamData = async () => {
    if (!configured()) throw new Error('De voetbal.nl API is nog niet geconfigureerd.');
    const [matches, trainings, players, otherFixtures] = await Promise.all([
        getCollection(process.env.VOETBAL_NL_MATCHES_URL),
        getCollection(process.env.VOETBAL_NL_TRAININGS_URL),
        getCollection(process.env.VOETBAL_NL_PLAYERS_URL),
        process.env.VOETBAL_NL_OTHER_FIXTURES_URL ? getCollection(process.env.VOETBAL_NL_OTHER_FIXTURES_URL) : Promise.resolve([])
    ]);
    return { matches, trainings, players, otherFixtures };
};

module.exports = { configured, fetchTeamData };
