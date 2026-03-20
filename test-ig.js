const { runInstagramEngagement } = require('./src/services/instagram-engage');
const fs = require('fs');

process.on('unhandledRejection', (reason) => {
  fs.writeFileSync('err.json', JSON.stringify({name: reason.name, message: reason.message, stack: reason.stack}, null, 2));
  console.log('Wrote unhandled rejection to err.json');
  process.exit(1);
});

console.log('Running test...');
runInstagramEngagement().then(() => console.log('Done')).catch(e => {
  fs.writeFileSync('err.json', JSON.stringify({name: e.name, message: e.message, stack: e.stack}, null, 2));
  console.log('Wrote caught error to err.json');
});
