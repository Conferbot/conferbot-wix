'use strict';

const cfg = require('./config');
const createApp = require('./server');

const { app } = createApp(cfg);

app.listen(cfg.port, () => {
  console.log(`conferbot-wix listening on :${cfg.port} (app url: ${cfg.appUrl})`);
});
