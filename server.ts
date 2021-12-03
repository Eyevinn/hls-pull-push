import { HLSPullPush, MediaPackageOutput } from "./src/index";


const pullPushService = new HLSPullPush();
pullPushService.registerPlugin("mediapackage", new MediaPackageOutput());

console.log("Running");
pullPushService.listen(process.env.PORT || 8080);

