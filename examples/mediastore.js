// Pull HLS and push to a AWS MediaStore destination

const { HLSPullPush, MediaStoreOutput } = require('../dist/index.js');

const pullPushService = new HLSPullPush();
pullPushService.registerPlugin('mediastore', new MediaStoreOutput());

console.log('Running');
pullPushService.listen(process.env.PORT || 8080);
