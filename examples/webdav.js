// Pull HLS and push to a WebDAV destination

const { HLSPullPush, MediaPackageOutput } = require('../dist/index.js');

const pullPushService = new HLSPullPush();
pullPushService.registerPlugin('mediapackage', new MediaPackageOutput());

console.log('Running');
pullPushService.listen(process.env.PORT || 8080);
