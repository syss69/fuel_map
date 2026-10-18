require('./station-name-matching.cjs').main().catch(error => { console.error(error.message); process.exitCode = 1; });
