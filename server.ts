import { HLSPullPush, MediaPackageOutput } from "./index";

const pullPushService = new HLSPullPush();
pullPushService.registerPlugin("mediapackage", new MediaPackageOutput());

pullPushService.getLogger().info("Running");
pullPushService.listen(process.env.PORT || 8080);

