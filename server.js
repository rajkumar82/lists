const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 8080;
const app = express();

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (path.basename(file) === 'sw.js') res.set('Cache-Control', 'no-cache');
  },
}));

app.listen(PORT, () => console.log(`Lists listening on ${PORT}`));
