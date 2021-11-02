// Pull HLS and push to a WebDAV destination

const { HLSPullPush, WebDAV } = require("../dist/index.js");

const destPlugin = new WebDAV({
  destination: "webdav://destination",
  username: USERNAME,
  password: PASSWORD
});
const pullPushService = new HLSPullPush({
  dest: destPlugin
});
pullPushService.listen(process.env.PORT || 8080);
