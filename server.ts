import { HLSPullPush } from "./src/index";

console.log("Running");
const pullPushService = new HLSPullPush({
  dest: "dummy-input",
});

pullPushService.listen(process.env.PORT || 8080);
