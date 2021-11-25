import { HLSPullPush } from "./src/index";
import { MediaPackageOutput } from "./output_plugins/mediapackage";


const pullPushService = new HLSPullPush();
pullPushService.registerPlugin("mediapackage", new MediaPackageOutput());

console.log("Running");
pullPushService.listen(process.env.PORT || 8080);

